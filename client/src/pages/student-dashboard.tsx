import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  TrendingUp, TrendingDown, Minus, Target, CheckCircle2, XCircle, MinusCircle,
  History, Eye, Calendar, BarChart3, AlertTriangle, Users, GraduationCap,
  ArrowRight, Lightbulb, Download, Lock, Unlock, Trophy, Activity, FileBarChart,
  Bell, LogOut
} from 'lucide-react';
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  BarChart,
  Bar,
  Cell,
  ScatterChart,
  Scatter,
  ZAxis,
  AreaChart,
  Area,
} from 'recharts';

// ============================================================================
// TYPES
// ============================================================================

interface StudentResult {
  id: string;
  exam_id: string;
  student_name: string;
  student_number: string | null;
  turma: string | null;
  answers: string[];
  score: number | null;
  correct_answers: number | null;
  wrong_answers: number | null;
  blank_answers: number | null;
  tri_score: number | null;
  tri_lc: number | null;
  tri_ch: number | null;
  tri_cn: number | null;
  tri_mt: number | null;
  created_at: string;
  exams?: {
    id: string;
    title: string;
    template_type: string;
    created_at: string;
  };
}

interface DashboardDetails {
  studentResult: any;
  exam: { id: string; title: string; templateType: string; totalQuestions: number };
  answerKey: string[];
  questionContents: Array<{ questionNumber: number; content: string; area?: string }>;
  questionDifficulty: Array<{
    questionNumber: number;
    area: string;
    content: string;
    correctRate: number;
    difficulty: 'easy' | 'medium' | 'hard';
    totalCorrect: number;
    totalStudents: number;
  }>;
  studentWrongQuestions: Array<{
    questionNumber: number;
    area: string;
    content: string;
    difficulty: 'easy' | 'medium' | 'hard';
    correctRate: number;
    studentAnswer: string;
    correctAnswer: string;
  }>;
  difficultyStats: {
    easy: { total: number; correct: number; wrong: number };
    medium: { total: number; correct: number; wrong: number };
    hard: { total: number; correct: number; wrong: number };
  };
  topErrorContents: Array<{ content: string; area: string; errors: number; total: number }>;
  turmaStats: {
    LC: { min: number; max: number; avg: number; count: number };
    CH: { min: number; max: number; avg: number; count: number };
    CN: { min: number; max: number; avg: number; count: number };
    MT: { min: number; max: number; avg: number; count: number };
  };
  turmaSize: number;
  turmaScatterData?: Array<{ acertos: number; tri: number; isCurrentStudent: boolean }>;
}

interface StudyPlanArea {
  area: string;
  areaName: string;
  tri_atual: number;
  tri_faixa: string;
  conteudos_prioritarios: Array<{
    conteudo: string;
    habilidade: string;
    tri_score: number;
  }>;
  listas_recomendadas: Array<{
    id: string;
    titulo: string;
    ordem: number;
    arquivo_url: string;
    arquivo_nome: string;
    arquivo_tipo: string;
    status?: 'available' | 'locked' | 'mastered';
    tri_min?: number;
    tri_max?: number;
  }>;
  listas_proximas?: Array<{
    id: string;
    titulo: string;
    tri_min: number;
    tri_max: number;
    pontos_para_desbloquear: number;
  }>;
  meta_proxima_faixa: {
    pontos_necessarios: number;
    proxima_faixa: string;
  };
}

interface StudyPlanData {
  studyPlan: StudyPlanArea[];
}

// ============================================================================
// CONSTANTS - XTRI BRAND COLORS
// ============================================================================

const XTRI_COLORS = {
  cyan: '#33B5E5',
  cyanLight: '#5AC8ED',
  cyanDark: '#1E9FCC',
  orange: '#F26A4B',
  orangeLight: '#F58A70',
  orangeDark: '#E04E2D',
  dark: '#1a2744',
};

// Configuração das áreas com cores XTRI
const AREA_CONFIG = {
  LC: {
    name: 'Linguagens',
    shortName: 'LC',
    color: XTRI_COLORS.cyan,
    gradient: 'from-[#33B5E5] to-[#1E9FCC]',
    bgLight: 'bg-cyan-50 dark:bg-cyan-950/30',
    border: 'border-cyan-200 dark:border-cyan-800',
    text: 'text-cyan-600 dark:text-cyan-400',
  },
  CH: {
    name: 'Humanas',
    shortName: 'CH',
    color: XTRI_COLORS.orange,
    gradient: 'from-[#F26A4B] to-[#E04E2D]',
    bgLight: 'bg-orange-50 dark:bg-orange-950/30',
    border: 'border-orange-200 dark:border-orange-800',
    text: 'text-orange-600 dark:text-orange-400',
  },
  CN: {
    name: 'Natureza',
    shortName: 'CN',
    color: '#10b981',
    gradient: 'from-emerald-500 to-teal-600',
    bgLight: 'bg-emerald-50 dark:bg-emerald-950/30',
    border: 'border-emerald-200 dark:border-emerald-800',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  MT: {
    name: 'Matemática',
    shortName: 'MT',
    color: '#6366f1',
    gradient: 'from-indigo-500 to-violet-600',
    bgLight: 'bg-indigo-50 dark:bg-indigo-950/30',
    border: 'border-indigo-200 dark:border-indigo-800',
    text: 'text-indigo-600 dark:text-indigo-400',
  },
};

// Classificação TRI
const classificarTRI = (tri: number | null): { label: string; color: string; bgColor: string; emoji: string } => {
  if (!tri || tri === 0) return { label: 'Não calculado', color: 'text-gray-500', bgColor: 'bg-gray-100', emoji: '⚪' };
  if (tri < 450) return { label: 'Crítico', color: 'text-red-600', bgColor: 'bg-red-50', emoji: '🔴' };
  if (tri < 550) return { label: 'Abaixo da média', color: 'text-orange-600', bgColor: 'bg-orange-50', emoji: '🟠' };
  if (tri < 650) return { label: 'Na média', color: 'text-yellow-600', bgColor: 'bg-yellow-50', emoji: '🟡' };
  if (tri < 750) return { label: 'Acima da média', color: 'text-green-600', bgColor: 'bg-green-50', emoji: '🟢' };
  return { label: 'Excelente', color: 'text-blue-600', bgColor: 'bg-blue-50', emoji: '🔵' };
};

// ============================================================================
// STAT CARD COMPONENT - NexLink Style with XTRI Colors
// ============================================================================

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  gradient: string;
  delay?: number;
}

function StatCard({ title, value, subtitle, icon: Icon, gradient, delay = 0 }: StatCardProps) {
  return (
    <div
      className={`
        relative overflow-hidden rounded-2xl p-6
        bg-gradient-to-br ${gradient}
        shadow-xl shadow-black/10
        transform hover:scale-[1.02] hover:-translate-y-1
        transition-all duration-300 ease-out
      `}
      style={{
        animation: `fadeSlideUp 0.5s ease-out ${delay}ms both`,
      }}
    >
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-16 translate-x-16" />
      <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/10 rounded-full translate-y-12 -translate-x-12" />

      <div className="relative z-10">
        <div className="flex items-start justify-between mb-4">
          <div className="p-3 rounded-xl bg-white/20 backdrop-blur-sm">
            <Icon className="w-6 h-6 text-white" />
          </div>
        </div>

        <p className="text-white/80 text-sm font-medium mb-1">{title}</p>
        <p className="text-3xl font-bold text-white tracking-tight">{value}</p>
        {subtitle && (
          <p className="text-white/60 text-xs mt-1">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// AREA CARD COMPONENT - NexLink Style
// ============================================================================

interface AreaCardProps {
  area: keyof typeof AREA_CONFIG;
  tri: number | null;
  turmaStats?: { min: number; max: number; avg: number };
  delay?: number;
}

function AreaCard({ area, tri, turmaStats, delay = 0 }: AreaCardProps) {
  const config = AREA_CONFIG[area];
  const classification = classificarTRI(tri);

  const getPositionPercent = () => {
    if (!tri || !turmaStats) return 50;
    const range = turmaStats.max - turmaStats.min;
    if (range === 0) return 50;
    return Math.min(100, Math.max(0, ((tri - turmaStats.min) / range) * 100));
  };

  const positionPercent = getPositionPercent();
  const isAboveAvg = tri && turmaStats && tri > turmaStats.avg;
  const diff = tri && turmaStats ? Math.abs(tri - turmaStats.avg) : 0;

  return (
    <div
      className={`
        relative overflow-hidden rounded-2xl border-2 ${config.border}
        bg-white dark:bg-gray-900
        shadow-lg shadow-black/5 hover:shadow-xl
        transform hover:-translate-y-1
        transition-all duration-300
      `}
      style={{
        animation: `fadeSlideUp 0.5s ease-out ${delay}ms both`,
      }}
    >
      {/* Top gradient bar */}
      <div className={`h-1.5 bg-gradient-to-r ${config.gradient}`} />

      <div className="p-5">
        {/* Title and Score */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${config.gradient} flex items-center justify-center shadow-lg`}>
              <span className="text-white text-sm font-bold">{config.shortName}</span>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">{config.name}</h3>
              <p className="text-xs text-gray-500">Nota TRI</p>
            </div>
          </div>
          <div className="text-right">
            <p className={`text-3xl font-bold ${config.text}`}>
              {tri?.toFixed(0) || '---'}
            </p>
          </div>
        </div>

        {/* Progress bar showing position in turma */}
        {turmaStats && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Min: {turmaStats.min.toFixed(0)}</span>
              <span>Média: {turmaStats.avg.toFixed(0)}</span>
              <span>Max: {turmaStats.max.toFixed(0)}</span>
            </div>
            <div className="relative h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div className={`absolute inset-0 bg-gradient-to-r ${config.gradient} opacity-20`} />

              {/* Average marker */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-gray-400 z-10"
                style={{ left: `${((turmaStats.avg - turmaStats.min) / (turmaStats.max - turmaStats.min)) * 100}%` }}
              />

              {/* Student position marker */}
              {tri && (
                <div
                  className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-gradient-to-br ${config.gradient} border-2 border-white shadow-lg z-20 transition-all duration-500`}
                  style={{ left: `calc(${positionPercent}% - 8px)` }}
                />
              )}
            </div>

            {/* Comparison badge */}
            {tri && (
              <div className={`flex items-center gap-1 text-xs font-medium ${isAboveAvg ? 'text-emerald-600' : 'text-orange-600'}`}>
                {isAboveAvg ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                <span>
                  {isAboveAvg
                    ? `+${diff.toFixed(0)} pts acima da média`
                    : `-${diff.toFixed(0)} pts abaixo da média`
                  }
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// DIFFICULTY CARD COMPONENT
// ============================================================================

interface DifficultyCardProps {
  difficulty: 'easy' | 'medium' | 'hard';
  stats: { total: number; correct: number; wrong: number };
}

function DifficultyCard({ difficulty, stats }: DifficultyCardProps) {
  const config = {
    easy: {
      label: 'Fáceis',
      emoji: '🟢',
      gradient: 'from-emerald-500 to-teal-600',
      bg: 'bg-emerald-50 dark:bg-emerald-950/30',
      border: 'border-emerald-200 dark:border-emerald-800',
      text: 'text-emerald-600'
    },
    medium: {
      label: 'Médias',
      emoji: '🟡',
      gradient: 'from-amber-500 to-orange-600',
      bg: 'bg-amber-50 dark:bg-amber-950/30',
      border: 'border-amber-200 dark:border-amber-800',
      text: 'text-amber-600'
    },
    hard: {
      label: 'Difíceis',
      emoji: '🔴',
      gradient: 'from-red-500 to-rose-600',
      bg: 'bg-red-50 dark:bg-red-950/30',
      border: 'border-red-200 dark:border-red-800',
      text: 'text-red-600'
    },
  };

  const c = config[difficulty];
  const percentage = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;

  return (
    <div className={`rounded-2xl p-5 ${c.bg} border-2 ${c.border}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {c.emoji} {c.label}
        </span>
        <span className={`text-2xl font-bold ${c.text}`}>{percentage}%</span>
      </div>
      <div className="relative h-2.5 bg-white/50 dark:bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 bg-gradient-to-r ${c.gradient} rounded-full transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="flex justify-between mt-2 text-xs text-gray-500">
        <span>Acertei: {stats.correct}/{stats.total}</span>
        <span>Errei: {stats.wrong}</span>
      </div>
    </div>
  );
}

// ============================================================================
// LOADING SKELETON
// ============================================================================

function LoadingCard() {
  return (
    <div className="rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-lg animate-pulse">
      <Skeleton className="h-10 w-10 rounded-xl mb-4" />
      <Skeleton className="h-4 w-20 mb-2" />
      <Skeleton className="h-8 w-24" />
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function StudentDashboard() {
  const { profile, signOut } = useAuth();

  // Data State
  const [results, setResults] = useState<StudentResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedExamId, setSelectedExamId] = useState<string>('');
  const [details, setDetails] = useState<DashboardDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [studyPlan, setStudyPlan] = useState<StudyPlanData | null>(null);
  const [studyPlanLoading, setStudyPlanLoading] = useState(false);

  // Dialog state
  const [dialogResult, setDialogResult] = useState<StudentResult | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Filters
  const [selectedAreaFilter, setSelectedAreaFilter] = useState<string>('all');
  const [selectedDifficultyFilter, setSelectedDifficultyFilter] = useState<string>('all');

  // Visible lines for evolution chart
  const [visibleLines, setVisibleLines] = useState({
    LC: true, CH: true, CN: true, MT: true, geral: true
  });

  const toggleLine = (line: keyof typeof visibleLines) => {
    setVisibleLines(prev => ({ ...prev, [line]: !prev[line] }));
  };

  // Refs
  const historyRef = useRef<HTMLDivElement>(null);

  // Fetch results
  useEffect(() => {
    async function fetchResults() {
      if (!profile?.id) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const response = await authFetch(`/api/student-answers/${profile.id}`);
        const data = await response.json();

        if (data.success) {
          setResults(data.results || []);
          if (data.results?.length > 0 && !selectedExamId) {
            setSelectedExamId(data.results[0].exam_id);
          }
        } else {
          setError(data.error || 'Erro ao carregar resultados');
        }
      } catch (err) {
        console.error('Erro ao buscar resultados:', err);
        setError('Erro de conexão ao buscar resultados');
      } finally {
        setLoading(false);
      }
    }

    fetchResults();
  }, [profile?.id]);

  // Fetch details
  useEffect(() => {
    async function fetchDetails() {
      if (!selectedExamId || !profile?.id) return;

      try {
        setDetailsLoading(true);
        const response = await fetch(`/api/student-dashboard-details/${profile.id}/${selectedExamId}`);
        const data = await response.json();

        if (data.success) {
          setDetails(data);
        }
      } catch (err) {
        console.error('Erro ao buscar detalhes:', err);
      } finally {
        setDetailsLoading(false);
      }
    }

    fetchDetails();
  }, [selectedExamId, profile?.id]);

  // Fetch study plan
  useEffect(() => {
    async function fetchStudyPlan() {
      if (!selectedExamId || !profile?.id) return;

      try {
        setStudyPlanLoading(true);
        const response = await authFetch(`/api/student/study-plan/${profile.id}/${selectedExamId}`);
        const data = await response.json();

        if (data.success) {
          setStudyPlan(data);
        }
      } catch (err) {
        console.error('Erro ao buscar plano de estudos:', err);
      } finally {
        setStudyPlanLoading(false);
      }
    }

    fetchStudyPlan();
  }, [selectedExamId, profile?.id]);

  // Computed values
  const selectedResult = results.find(r => r.exam_id === selectedExamId) || (results.length > 0 ? results[0] : null);
  const totalProvas = results.length;
  const mediaTriGeral = results.length > 0
    ? results.filter(r => r.tri_score).reduce((acc, r) => acc + (r.tri_score || 0), 0) / results.filter(r => r.tri_score).length
    : 0;

  const getPreviousTRI = (index: number): number | null => {
    if (index + 1 < results.length) {
      return results[index + 1].tri_score;
    }
    return null;
  };

  const filteredWrongQuestions = useMemo(() => {
    if (!details?.studentWrongQuestions) return [];
    return details.studentWrongQuestions.filter(q => {
      const areaMatch = selectedAreaFilter === 'all' || q.area === selectedAreaFilter;
      const diffMatch = selectedDifficultyFilter === 'all' || q.difficulty === selectedDifficultyFilter;
      return areaMatch && diffMatch;
    });
  }, [details?.studentWrongQuestions, selectedAreaFilter, selectedDifficultyFilter]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-cyan-50/30 dark:from-gray-950 dark:via-gray-900 dark:to-cyan-950/10">
      {/* CSS Animation */}
      <style>{`
        @keyframes fadeSlideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-800/50">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-4 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            {/* XTRI Logo */}
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#33B5E5] to-[#1E9FCC] flex items-center justify-center shadow-lg shadow-cyan-500/30">
                <span className="text-white font-black text-sm">X</span>
              </div>
              <span className="font-bold text-lg text-gray-900 dark:text-white hidden sm:block">XTRI</span>
            </div>

            <div className="h-8 w-px bg-gray-200 dark:bg-gray-700 hidden sm:block" />

            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                Olá, {profile?.name?.split(' ')[0] || 'Aluno'}!
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {profile?.student_number && `Matrícula: ${profile.student_number}`}
                {profile?.turma && ` • Turma: ${profile.turma}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Exam Selector */}
            {results.length > 1 && (
              <Select value={selectedExamId} onValueChange={setSelectedExamId}>
                <SelectTrigger className="w-[180px] lg:w-[260px] border-cyan-200 focus:ring-cyan-500 bg-white dark:bg-gray-800">
                  <SelectValue placeholder="Selecione um simulado" />
                </SelectTrigger>
                <SelectContent>
                  {results.map((result, index) => (
                    <SelectItem key={result.exam_id} value={result.exam_id}>
                      {result.exams?.title || 'Prova'} - {new Date(result.created_at).toLocaleDateString('pt-BR')}
                      {index === 0 && ' (mais recente)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Notification Bell */}
            <button className="relative p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <Bell className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#F26A4B] rounded-full" />
            </button>

            {/* Logout Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="text-gray-500 hover:text-red-500 hover:bg-red-50"
            >
              <LogOut className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-8 space-y-8">

        {/* Loading State */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => <LoadingCard key={i} />)}
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 border-2 border-red-200 dark:border-red-800 p-6">
            <p className="text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && results.length === 0 && (
          <div className="text-center py-20">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-[#33B5E5] to-[#1E9FCC] flex items-center justify-center shadow-xl shadow-cyan-500/30">
              <Target className="w-10 h-10 text-white" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              Nenhum resultado encontrado
            </h3>
            <p className="text-gray-500 dark:text-gray-400">
              Seus resultados aparecerão aqui após realizar provas.
            </p>
          </div>
        )}

        {/* Dashboard with Results */}
        {!loading && !error && selectedResult && (
          <>
            {/* ============================================================ */}
            {/* STAT CARDS - XTRI Colors */}
            {/* ============================================================ */}
            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatCard
                title="Nota TRI Geral"
                value={selectedResult.tri_score?.toFixed(0) || '---'}
                subtitle={classificarTRI(selectedResult.tri_score).label}
                icon={Trophy}
                gradient="from-[#33B5E5] to-[#1E9FCC]"
                delay={0}
              />
              <StatCard
                title="Acertos"
                value={selectedResult.correct_answers ?? '---'}
                subtitle={`de ${selectedResult.answers?.length || 180} questões`}
                icon={CheckCircle2}
                gradient="from-emerald-500 to-teal-600"
                delay={100}
              />
              <StatCard
                title="Simulados"
                value={totalProvas}
                subtitle="provas realizadas"
                icon={FileBarChart}
                gradient="from-indigo-500 to-violet-600"
                delay={200}
              />
              <StatCard
                title="Média Geral"
                value={mediaTriGeral.toFixed(0)}
                subtitle="nota TRI média"
                icon={Activity}
                gradient="from-[#F26A4B] to-[#E04E2D]"
                delay={300}
              />
            </section>

            {/* ============================================================ */}
            {/* PERFORMANCE BY AREA */}
            {/* ============================================================ */}
            <section className="space-y-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <BarChart3 className="w-6 h-6 text-[#33B5E5]" />
                    Desempenho por Área
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Compare sua nota com a turma em cada área
                  </p>
                </div>
                {details && (
                  <Badge variant="outline" className="flex items-center gap-1.5 px-3 py-1.5 border-[#33B5E5] text-[#33B5E5]">
                    <Users className="w-4 h-4" />
                    {details.turmaSize} alunos
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {detailsLoading ? (
                  [...Array(4)].map((_, i) => <LoadingCard key={i} />)
                ) : (
                  <>
                    <AreaCard area="LC" tri={selectedResult.tri_lc} turmaStats={details?.turmaStats?.LC} delay={0} />
                    <AreaCard area="CH" tri={selectedResult.tri_ch} turmaStats={details?.turmaStats?.CH} delay={100} />
                    <AreaCard area="CN" tri={selectedResult.tri_cn} turmaStats={details?.turmaStats?.CN} delay={200} />
                    <AreaCard area="MT" tri={selectedResult.tri_mt} turmaStats={details?.turmaStats?.MT} delay={300} />
                  </>
                )}
              </div>
            </section>

            {/* ============================================================ */}
            {/* DIFFICULTY ANALYSIS */}
            {/* ============================================================ */}
            {details?.difficultyStats && (
              <section className="space-y-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Target className="w-6 h-6 text-[#F26A4B]" />
                  Análise por Dificuldade
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <DifficultyCard difficulty="easy" stats={details.difficultyStats.easy} />
                  <DifficultyCard difficulty="medium" stats={details.difficultyStats.medium} />
                  <DifficultyCard difficulty="hard" stats={details.difficultyStats.hard} />
                </div>

                {/* Wrong Questions Table */}
                {details.studentWrongQuestions.length > 0 && (
                  <Card className="border-2 border-gray-100 dark:border-gray-800 shadow-lg rounded-2xl overflow-hidden">
                    <CardHeader className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50">
                      <div className="flex items-center justify-between flex-wrap gap-4">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5 text-amber-500" />
                          Questões para Revisar ({filteredWrongQuestions.length})
                        </CardTitle>
                        <div className="flex gap-2">
                          <Select value={selectedAreaFilter} onValueChange={setSelectedAreaFilter}>
                            <SelectTrigger className="w-[130px] h-9">
                              <SelectValue placeholder="Área" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Todas Áreas</SelectItem>
                              <SelectItem value="LC">Linguagens</SelectItem>
                              <SelectItem value="CH">Humanas</SelectItem>
                              <SelectItem value="CN">Natureza</SelectItem>
                              <SelectItem value="MT">Matemática</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select value={selectedDifficultyFilter} onValueChange={setSelectedDifficultyFilter}>
                            <SelectTrigger className="w-[130px] h-9">
                              <SelectValue placeholder="Dificuldade" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Todas</SelectItem>
                              <SelectItem value="easy">🟢 Fáceis</SelectItem>
                              <SelectItem value="medium">🟡 Médias</SelectItem>
                              <SelectItem value="hard">🔴 Difíceis</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="max-h-[400px] overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-gray-50 dark:bg-gray-800/50">
                              <TableHead className="w-[60px] font-semibold">Nº</TableHead>
                              <TableHead className="font-semibold">Conteúdo</TableHead>
                              <TableHead className="w-[90px] font-semibold">Área</TableHead>
                              <TableHead className="w-[100px] font-semibold">Dificuldade</TableHead>
                              <TableHead className="w-[120px] text-center font-semibold">Resposta</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredWrongQuestions.slice(0, 20).map((q) => (
                              <TableRow key={q.questionNumber} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                <TableCell className="font-medium">{q.questionNumber}</TableCell>
                                <TableCell className="text-sm text-gray-600 dark:text-gray-400 max-w-[250px] truncate" title={q.content}>
                                  {q.content || `Questão ${q.questionNumber}`}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-xs">{q.area}</Badge>
                                </TableCell>
                                <TableCell>
                                  <span className="text-xs">
                                    {q.difficulty === 'easy' ? '🟢' : q.difficulty === 'medium' ? '🟡' : '🔴'}
                                  </span>
                                  <span className="text-xs text-gray-400 ml-1">({q.correctRate.toFixed(0)}%)</span>
                                </TableCell>
                                <TableCell className="text-center">
                                  <span className="text-red-500 font-bold">{q.studentAnswer}</span>
                                  <span className="text-gray-400 mx-1">/</span>
                                  <span className="text-green-600 font-bold">{q.correctAnswer}</span>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </section>
            )}

            {/* ============================================================ */}
            {/* STUDY PLAN */}
            {/* ============================================================ */}
            {studyPlan?.studyPlan && studyPlan.studyPlan.length > 0 && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <GraduationCap className="w-6 h-6 text-[#33B5E5]" />
                    Plano de Estudos Personalizado
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Baseado no seu desempenho TRI, preparamos conteúdos prioritários
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {studyPlan.studyPlan.map((plan) => {
                    const areaConfig = AREA_CONFIG[plan.area as keyof typeof AREA_CONFIG];
                    if (!areaConfig) return null;

                    return (
                      <Card key={plan.area} className={`border-2 ${areaConfig.border} rounded-2xl overflow-hidden`}>
                        <div className={`h-1.5 bg-gradient-to-r ${areaConfig.gradient}`} />
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2">
                              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${areaConfig.gradient} flex items-center justify-center`}>
                                <span className="text-white text-xs font-bold">{areaConfig.shortName}</span>
                              </div>
                              <span className={areaConfig.text}>{areaConfig.name}</span>
                            </CardTitle>
                            <Badge variant="outline">TRI: {plan.tri_atual?.toFixed(0) || '---'}</Badge>
                          </div>
                          {plan.meta_proxima_faixa && plan.meta_proxima_faixa.pontos_necessarios > 0 && (
                            <div className="flex items-center gap-1.5 text-xs text-amber-600 mt-2">
                              <Lightbulb className="w-4 h-4" />
                              <span>Meta: +{Math.round(plan.meta_proxima_faixa.pontos_necessarios)} pts para {plan.meta_proxima_faixa.proxima_faixa}</span>
                            </div>
                          )}
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {plan.conteudos_prioritarios && plan.conteudos_prioritarios.length > 0 ? (
                            <div>
                              <p className="text-xs font-medium text-gray-500 mb-2">Conteúdos para focar:</p>
                              <ul className="space-y-1.5">
                                {plan.conteudos_prioritarios.slice(0, 5).map((conteudo, idx) => (
                                  <li key={idx} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                                    <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                                    {conteudo.conteudo}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500">
                              Parabéns! Você está em um ótimo nível nesta área.
                            </p>
                          )}

                          {/* Available Lists */}
                          {plan.listas_recomendadas && plan.listas_recomendadas.length > 0 && (
                            <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
                              <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                                <Unlock className="w-3 h-3 text-green-500" />
                                Listas Disponíveis ({plan.listas_recomendadas.length}):
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {plan.listas_recomendadas.map((lista) => (
                                  <a
                                    key={lista.id}
                                    href={lista.arquivo_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => {
                                      authFetch('/api/list-downloads', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ listId: lista.id }),
                                      }).catch(() => {});
                                    }}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border ${areaConfig.border} ${areaConfig.text} hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors`}
                                    title={lista.tri_min && lista.tri_max ? `Faixa TRI: ${Math.round(lista.tri_min)}-${Math.round(lista.tri_max)}` : ''}
                                  >
                                    <Download className="w-3 h-3" />
                                    {lista.titulo.replace(/Lista \d+ - /, '').replace(/\(\d+-\d+\)/, '').trim() || `Lista ${lista.ordem}`}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Locked Lists */}
                          {plan.listas_proximas && plan.listas_proximas.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-gray-400 mb-1 flex items-center gap-1">
                                <Lock className="w-3 h-3" />
                                Próximas Listas:
                              </p>
                              <p className="text-[10px] text-gray-400 mb-2">
                                Suba sua nota TRI para desbloquear mais listas
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {plan.listas_proximas.map((lista) => (
                                  <div
                                    key={lista.id}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400 bg-gray-50 dark:bg-gray-800 cursor-not-allowed"
                                    title={`+${Math.round(lista.pontos_para_desbloquear)} pts TRI`}
                                  >
                                    <Lock className="w-3 h-3" />
                                    <span>TRI {Math.round(lista.tri_min)}+</span>
                                    <span className="text-[10px] opacity-70">(+{Math.round(lista.pontos_para_desbloquear)})</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </section>
            )}

            {studyPlanLoading && (
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <GraduationCap className="w-5 h-5 text-[#33B5E5]" />
                    Plano de Estudos Personalizado
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ============================================================ */}
            {/* EVOLUTION CHART */}
            {/* ============================================================ */}
            <section className="space-y-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-6 h-6 text-[#33B5E5]" />
                Evolução do TRI
              </h2>

              {results.length >= 2 ? (
                <Card className="border-2 border-gray-100 dark:border-gray-800 shadow-lg rounded-2xl overflow-hidden">
                  <CardHeader className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => toggleLine('geral')}
                        className={`px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                          visibleLines.geral
                            ? 'bg-gray-800 text-white shadow-md'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        Média Geral
                      </button>
                      {(['LC', 'CH', 'CN', 'MT'] as const).map((area) => {
                        const config = AREA_CONFIG[area];
                        return (
                          <button
                            key={area}
                            onClick={() => toggleLine(area)}
                            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                              visibleLines[area]
                                ? `bg-gradient-to-r ${config.gradient} text-white shadow-md`
                                : `${config.bgLight} ${config.text}`
                            }`}
                          >
                            {config.name}
                          </button>
                        );
                      })}
                    </div>
                  </CardHeader>
                  <CardContent className="p-6">
                    <ResponsiveContainer width="100%" height={350}>
                      <AreaChart
                        data={[...results]
                          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                          .map((result) => ({
                            date: new Date(result.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
                            fullDate: new Date(result.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
                            prova: result.exams?.title || 'Prova',
                            LC: result.tri_lc,
                            CH: result.tri_ch,
                            CN: result.tri_cn,
                            MT: result.tri_mt,
                            geral: result.tri_score,
                          }))
                        }
                        margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
                      >
                        <defs>
                          <linearGradient id="colorGeral" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#1f2937" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#1f2937" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorLC" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#33B5E5" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#33B5E5" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorCH" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#F26A4B" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#F26A4B" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorCN" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorMT" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 12 }} />
                        <YAxis domain={[350, 800]} tick={{ fill: '#6b7280', fontSize: 12 }} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-white dark:bg-gray-800 border rounded-xl shadow-xl p-4">
                                  <p className="font-semibold text-gray-900 dark:text-white">{data.prova}</p>
                                  <p className="text-sm text-gray-500 mb-2">{data.fullDate}</p>
                                  <div className="space-y-1 text-sm">
                                    {visibleLines.geral && <p className="text-gray-800 dark:text-gray-200 font-semibold">Média: {data.geral?.toFixed(0) || '---'}</p>}
                                    {visibleLines.LC && <p style={{ color: '#33B5E5' }}>LC: {data.LC?.toFixed(0) || '---'}</p>}
                                    {visibleLines.CH && <p style={{ color: '#F26A4B' }}>CH: {data.CH?.toFixed(0) || '---'}</p>}
                                    {visibleLines.CN && <p className="text-emerald-600">CN: {data.CN?.toFixed(0) || '---'}</p>}
                                    {visibleLines.MT && <p className="text-indigo-600">MT: {data.MT?.toFixed(0) || '---'}</p>}
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <ReferenceLine y={550} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: 'Média Nacional', fill: '#f59e0b', fontSize: 10 }} />
                        {visibleLines.geral && (
                          <Area type="monotone" dataKey="geral" stroke="#1f2937" fill="url(#colorGeral)" strokeWidth={3} dot={{ r: 5, fill: '#1f2937' }} />
                        )}
                        {visibleLines.LC && <Area type="monotone" dataKey="LC" stroke="#33B5E5" fill="url(#colorLC)" strokeWidth={2} dot={{ r: 4, fill: '#33B5E5' }} />}
                        {visibleLines.CH && <Area type="monotone" dataKey="CH" stroke="#F26A4B" fill="url(#colorCH)" strokeWidth={2} dot={{ r: 4, fill: '#F26A4B' }} />}
                        {visibleLines.CN && <Area type="monotone" dataKey="CN" stroke="#10b981" fill="url(#colorCN)" strokeWidth={2} dot={{ r: 4, fill: '#10b981' }} />}
                        {visibleLines.MT && <Area type="monotone" dataKey="MT" stroke="#6366f1" fill="url(#colorMT)" strokeWidth={2} dot={{ r: 4, fill: '#6366f1' }} />}
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-2 border-gray-100 dark:border-gray-800 shadow-lg rounded-2xl">
                  <CardContent className="py-16 text-center">
                    <TrendingUp className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                    <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Continue fazendo provas!
                    </h3>
                    <p className="text-gray-500">
                      O gráfico de evolução aparecerá quando você tiver 2 ou mais provas.
                    </p>
                  </CardContent>
                </Card>
              )}
            </section>

            {/* ============================================================ */}
            {/* SUMMARY CARDS */}
            {/* ============================================================ */}
            <section className="space-y-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                Resumo de Acertos
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div className="rounded-2xl p-6 bg-emerald-50 dark:bg-emerald-950/30 border-2 border-emerald-200 dark:border-emerald-800">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-emerald-100 dark:bg-emerald-900/50">
                      <CheckCircle2 className="w-7 h-7 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-400">
                        {selectedResult.correct_answers ?? '---'}
                      </p>
                      <p className="text-sm text-emerald-600/70">Acertos</p>
                    </div>
                  </div>
                  {selectedResult.correct_answers !== null && selectedResult.answers && (
                    <div className="mt-4">
                      <div className="h-2 bg-emerald-200/50 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full"
                          style={{ width: `${(selectedResult.correct_answers / selectedResult.answers.length) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl p-6 bg-red-50 dark:bg-red-950/30 border-2 border-red-200 dark:border-red-800">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-red-100 dark:bg-red-900/50">
                      <XCircle className="w-7 h-7 text-red-600" />
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-red-700 dark:text-red-400">
                        {selectedResult.wrong_answers ?? '---'}
                      </p>
                      <p className="text-sm text-red-600/70">Erros</p>
                    </div>
                  </div>
                  {selectedResult.wrong_answers !== null && selectedResult.answers && (
                    <div className="mt-4">
                      <div className="h-2 bg-red-200/50 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-red-500 to-rose-500 rounded-full"
                          style={{ width: `${(selectedResult.wrong_answers / selectedResult.answers.length) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl p-6 bg-gray-50 dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-gray-100 dark:bg-gray-700">
                      <MinusCircle className="w-7 h-7 text-gray-500" />
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-gray-700 dark:text-gray-300">
                        {selectedResult.blank_answers ?? '---'}
                      </p>
                      <p className="text-sm text-gray-500">Em Branco</p>
                    </div>
                  </div>
                  {selectedResult.blank_answers !== null && selectedResult.answers && (
                    <div className="mt-4">
                      <div className="h-2 bg-gray-200/50 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gray-400 rounded-full"
                          style={{ width: `${(selectedResult.blank_answers / selectedResult.answers.length) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* ============================================================ */}
            {/* HISTORY TABLE */}
            {/* ============================================================ */}
            <section ref={historyRef} className="space-y-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <History className="w-6 h-6 text-[#F26A4B]" />
                Histórico de Provas
              </h2>

              <Card className="border-2 border-gray-100 dark:border-gray-800 shadow-lg rounded-2xl overflow-hidden">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gradient-to-r from-cyan-50 to-orange-50/50 dark:from-cyan-950/30 dark:to-orange-950/30">
                        <TableHead className="font-semibold">Data</TableHead>
                        <TableHead className="font-semibold">Prova</TableHead>
                        <TableHead className="text-center font-semibold">Acertos</TableHead>
                        <TableHead className="text-center font-semibold">TRI</TableHead>
                        <TableHead className="text-center font-semibold">Evolução</TableHead>
                        <TableHead className="text-right font-semibold">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.map((result, index) => {
                        const prevTRI = getPreviousTRI(index);
                        const diff = result.tri_score && prevTRI ? result.tri_score - prevTRI : null;

                        return (
                          <TableRow key={result.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                            <TableCell className="font-medium">
                              {new Date(result.created_at).toLocaleDateString('pt-BR', {
                                day: '2-digit', month: '2-digit', year: 'numeric'
                              })}
                            </TableCell>
                            <TableCell>
                              <div>
                                <p className="font-medium">{result.exams?.title || 'Prova'}</p>
                                <p className="text-xs text-gray-500">{result.exams?.template_type || 'ENEM'}</p>
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="font-medium text-emerald-600">{result.correct_answers ?? '-'}</span>
                              <span className="text-gray-400">/{result.answers?.length || '-'}</span>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge className={`${classificarTRI(result.tri_score).bgColor} ${classificarTRI(result.tri_score).color} border-0`}>
                                {result.tri_score?.toFixed(0) || '---'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              {diff !== null ? (
                                <div className={`flex items-center justify-center gap-1 ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                                  {diff > 0 ? <TrendingUp className="w-4 h-4" /> : diff < 0 ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                                  <span className="text-xs font-medium">{diff > 0 ? '+' : ''}{diff.toFixed(0)}</span>
                                </div>
                              ) : (
                                <Minus className="w-4 h-4 text-gray-400 mx-auto" />
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setDialogResult(result);
                                  setDialogOpen(true);
                                }}
                                className="hover:bg-cyan-50 hover:text-[#33B5E5]"
                              >
                                <Eye className="w-4 h-4 mr-1" />
                                Ver
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </main>

      {/* ============================================================ */}
      {/* DETAIL DIALOG */}
      {/* ============================================================ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md p-0 overflow-hidden rounded-2xl">
          {dialogResult && (
            <>
              {/* Header with XTRI gradient */}
              <div className="bg-gradient-to-br from-[#33B5E5] via-[#1E9FCC] to-[#F26A4B] p-6 text-white">
                <DialogHeader>
                  <DialogTitle className="text-white text-xl">{dialogResult.exams?.title || 'Análise da Prova'}</DialogTitle>
                  <DialogDescription className="text-white/80">
                    {new Date(dialogResult.created_at).toLocaleDateString('pt-BR', {
                      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
                    })}
                  </DialogDescription>
                </DialogHeader>

                <div className="mt-4 flex items-center justify-between">
                  <div>
                    <div className="text-white/70 text-sm">Sua nota TRI</div>
                    <div className="text-5xl font-black">{dialogResult.tri_score?.toFixed(0) || '---'}</div>
                  </div>
                  <div className={`px-4 py-2 rounded-full text-sm font-bold ${
                    classificarTRI(dialogResult.tri_score).label === 'Excelente' ? 'bg-blue-400/90 text-blue-900' :
                    classificarTRI(dialogResult.tri_score).label === 'Acima da média' ? 'bg-green-400/90 text-green-900' :
                    classificarTRI(dialogResult.tri_score).label === 'Na média' ? 'bg-yellow-400/90 text-yellow-900' :
                    'bg-red-400/90 text-red-900'
                  }`}>
                    {classificarTRI(dialogResult.tri_score).emoji} {classificarTRI(dialogResult.tri_score).label}
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  {(['LC', 'CH', 'CN', 'MT'] as const).map((area) => {
                    const config = AREA_CONFIG[area];
                    const tri = area === 'LC' ? dialogResult.tri_lc
                      : area === 'CH' ? dialogResult.tri_ch
                      : area === 'CN' ? dialogResult.tri_cn
                      : dialogResult.tri_mt;

                    return (
                      <div key={area} className={`p-4 rounded-xl ${config.bgLight} border ${config.border}`}>
                        <div className={`text-xs font-medium ${config.text} uppercase tracking-wide`}>{config.name}</div>
                        <div className={`text-2xl font-bold ${config.text} mt-1`}>{tri?.toFixed(0) || '---'}</div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex gap-3">
                  <div className="flex-1 text-center p-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800">
                    <div className="text-3xl font-black text-emerald-600">{dialogResult.correct_answers ?? '-'}</div>
                    <div className="text-xs text-emerald-600 font-medium mt-1">Acertos</div>
                  </div>
                  <div className="flex-1 text-center p-4 bg-red-50 dark:bg-red-950/30 rounded-xl border border-red-200 dark:border-red-800">
                    <div className="text-3xl font-black text-red-600">{dialogResult.wrong_answers ?? '-'}</div>
                    <div className="text-xs text-red-600 font-medium mt-1">Erros</div>
                  </div>
                  <div className="flex-1 text-center p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
                    <div className="text-3xl font-black text-gray-500">{dialogResult.blank_answers ?? '-'}</div>
                    <div className="text-xs text-gray-500 font-medium mt-1">Em Branco</div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm text-gray-500 pt-2 border-t">
                  <span>{dialogResult.answers?.length || 180} questões</span>
                  <span>{dialogResult.exams?.template_type || 'ENEM'}</span>
                  {dialogResult.turma && <span>Turma {dialogResult.turma}</span>}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
