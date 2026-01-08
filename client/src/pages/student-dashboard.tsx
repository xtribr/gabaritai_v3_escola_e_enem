import { useAuth } from '@/contexts/AuthContext';
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
  LogOut, TrendingUp, TrendingDown, Minus, BookOpen, Brain, Calculator, Leaf,
  Target, CheckCircle2, XCircle, MinusCircle, History, Eye, Calendar, BarChart3,
  AlertTriangle, Users, Award, GraduationCap, ArrowRight, Lightbulb, Download, FileText
} from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  BarChart,
  Bar,
  Cell,
  Legend,
  ScatterChart,
  Scatter,
  ZAxis,
} from 'recharts';

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
  }>;
  meta_proxima_faixa: number;
}

interface StudyPlanData {
  studyPlan: StudyPlanArea[];
}

// Função para classificar TRI
const classificarTRI = (tri: number | null): { label: string; color: string; emoji: string } => {
  if (!tri || tri === 0) return { label: 'Não calculado', color: 'bg-gray-100 text-gray-800', emoji: '⚪' };
  if (tri < 450) return { label: 'Crítico', color: 'bg-red-100 text-red-800', emoji: '🔴' };
  if (tri < 550) return { label: 'Abaixo da média', color: 'bg-orange-100 text-orange-800', emoji: '🟠' };
  if (tri < 650) return { label: 'Na média', color: 'bg-yellow-100 text-yellow-800', emoji: '🟡' };
  if (tri < 750) return { label: 'Acima da média', color: 'bg-green-100 text-green-800', emoji: '🟢' };
  return { label: 'Excelente', color: 'bg-blue-100 text-blue-800', emoji: '🔵' };
};

// Configuração das áreas - igual ao admin
const AREA_CONFIG = {
  LC: {
    name: 'Linguagens',
    color: 'purple',
    colors: {
      border: 'border-purple-200 dark:border-purple-800',
      text: 'text-purple-700 dark:text-purple-300',
      bar: 'bg-purple-500',
      marker: 'bg-purple-600'
    }
  },
  CH: {
    name: 'Humanas',
    color: 'orange',
    colors: {
      border: 'border-orange-200 dark:border-orange-800',
      text: 'text-orange-700 dark:text-orange-300',
      bar: 'bg-orange-500',
      marker: 'bg-orange-600'
    }
  },
  CN: {
    name: 'Natureza',
    color: 'green',
    colors: {
      border: 'border-green-200 dark:border-green-800',
      text: 'text-green-700 dark:text-green-300',
      bar: 'bg-green-500',
      marker: 'bg-green-600'
    }
  },
  MT: {
    name: 'Matemática',
    color: 'blue',
    colors: {
      border: 'border-blue-200 dark:border-blue-800',
      text: 'text-blue-700 dark:text-blue-300',
      bar: 'bg-blue-500',
      marker: 'bg-blue-600'
    }
  },
};

// Componente de Card de Loading
function LoadingCard() {
  return (
    <Card>
      <CardContent className="p-6">
        <Skeleton className="h-6 w-24 mb-2" />
        <Skeleton className="h-12 w-20 mb-2" />
        <Skeleton className="h-3 w-full mb-4" />
        <Skeleton className="h-16 w-full" />
      </CardContent>
    </Card>
  );
}

// Card de Área TRI - Design igual ao Admin
function AreaTRICardAdmin({
  area,
  studentTRI,
  turmaMin,
  turmaAvg,
  turmaMax,
}: {
  area: keyof typeof AREA_CONFIG;
  studentTRI: number | null;
  turmaMin: number;
  turmaAvg: number;
  turmaMax: number;
}) {
  const config = AREA_CONFIG[area];
  const colors = config.colors;

  // Calcular posição do aluno na barra (0-100%)
  const range = turmaMax - turmaMin;
  const position = range > 0 && studentTRI
    ? ((studentTRI - turmaMin) / range) * 100
    : 50;

  return (
    <Card className={`border-2 ${colors.border}`}>
      <CardContent className="p-6">
        <div className="space-y-4">
          {/* Nome da Área e Nota */}
          <div>
            <h3 className="text-lg font-bold mb-1">{config.name}</h3>
            <p className={`text-4xl font-bold ${colors.text}`}>
              {studentTRI?.toFixed(1) || '---'}
            </p>
            <p className="text-sm text-muted-foreground mt-1">TRI</p>
          </div>

          {/* Barra de Progresso com Marcador */}
          <div className="space-y-2">
            <div className="relative h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              {/* Fundo colorido transparente */}
              <div className={`absolute top-0 left-0 h-full ${colors.bar} opacity-30 w-full`}></div>
              {/* Marcador da posição do aluno */}
              {studentTRI && (
                <div
                  className={`absolute top-0 h-full w-1 ${colors.marker} shadow-lg`}
                  style={{ left: `${Math.max(0, Math.min(100, position))}%` }}
                ></div>
              )}
            </div>
          </div>

          {/* Estatísticas da Turma */}
          <div className="pt-2 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground mb-2">Estatísticas da Turma</p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-muted-foreground">Mínimo</p>
                <p className="font-bold">{turmaMin.toFixed(1)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Média</p>
                <p className="font-bold">{turmaAvg.toFixed(1)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Máximo</p>
                <p className="font-bold">{turmaMax.toFixed(1)}</p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Componente de Evolução
function EvolutionIndicator({ current, previous }: { current: number | null; previous: number | null }) {
  if (!current || !previous) return <Minus className="h-4 w-4 text-gray-400" />;

  const diff = current - previous;

  if (diff > 10) {
    return (
      <div className="flex items-center gap-1 text-green-600">
        <TrendingUp className="h-4 w-4" />
        <span className="text-xs font-medium">+{diff.toFixed(0)}</span>
      </div>
    );
  } else if (diff < -10) {
    return (
      <div className="flex items-center gap-1 text-red-600">
        <TrendingDown className="h-4 w-4" />
        <span className="text-xs font-medium">{diff.toFixed(0)}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 text-gray-500">
      <Minus className="h-4 w-4" />
      <span className="text-xs">~</span>
    </div>
  );
}

// Card de Dificuldade
function DifficultyCard({
  difficulty,
  stats,
}: {
  difficulty: 'easy' | 'medium' | 'hard';
  stats: { total: number; correct: number; wrong: number };
}) {
  const config = {
    easy: { label: 'Fáceis', emoji: '🟢', color: 'border-green-200', textColor: 'text-green-600', bgColor: 'bg-green-50' },
    medium: { label: 'Médias', emoji: '🟡', color: 'border-yellow-200', textColor: 'text-yellow-600', bgColor: 'bg-yellow-50' },
    hard: { label: 'Difíceis', emoji: '🔴', color: 'border-red-200', textColor: 'text-red-600', bgColor: 'bg-red-50' },
  };

  const c = config[difficulty];
  const percentage = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;

  return (
    <Card className={`${c.color} ${c.bgColor}`}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">{c.emoji} {c.label}</span>
          <span className={`text-2xl font-bold ${c.textColor}`}>{percentage}%</span>
        </div>
        <Progress value={percentage} className="h-2 mb-2" />
        <div className="flex justify-between text-xs text-gray-600">
          <span>Acertei: {stats.correct}/{stats.total}</span>
          <span>Errei: {stats.wrong}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function StudentDashboard() {
  const { profile, signOut } = useAuth();
  const [results, setResults] = useState<StudentResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<StudentResult | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Estados para análise detalhada
  const [details, setDetails] = useState<DashboardDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [selectedAreaFilter, setSelectedAreaFilter] = useState<string>('all');
  const [selectedDifficultyFilter, setSelectedDifficultyFilter] = useState<string>('all');

  // Estado para Plano de Estudos
  const [studyPlan, setStudyPlan] = useState<StudyPlanData | null>(null);
  const [studyPlanLoading, setStudyPlanLoading] = useState(false);

  // Buscar resultados do aluno
  useEffect(() => {
    async function fetchResults() {
      if (!profile?.id) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const response = await fetch(`/api/student-answers/${profile.id}`);
        const data = await response.json();

        if (data.success) {
          setResults(data.results || []);
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

  // Buscar detalhes quando tem resultado
  useEffect(() => {
    async function fetchDetails() {
      if (!results.length || !profile?.id) return;

      const ultimoResultado = results[0];
      if (!ultimoResultado.exam_id) return;

      try {
        setDetailsLoading(true);
        const response = await fetch(
          `/api/student-dashboard-details/${profile.id}/${ultimoResultado.exam_id}`
        );
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
  }, [results, profile?.id]);

  // Buscar plano de estudos
  useEffect(() => {
    async function fetchStudyPlan() {
      if (!results.length || !profile?.id) return;

      const ultimoResultado = results[0];
      if (!ultimoResultado.exam_id) return;

      try {
        setStudyPlanLoading(true);
        const response = await fetch(
          `/api/student/study-plan/${profile.id}/${ultimoResultado.exam_id}`
        );
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
  }, [results, profile?.id]);

  // Abrir dialog com detalhes
  const handleViewDetails = (result: StudentResult) => {
    setSelectedResult(result);
    setDialogOpen(true);
  };

  // Último resultado (mais recente)
  const ultimoResultado = results.length > 0 ? results[0] : null;

  // Calcular totais
  const totalProvas = results.length;
  const mediaTriGeral = results.length > 0
    ? results.filter(r => r.tri_score).reduce((acc, r) => acc + (r.tri_score || 0), 0) / results.filter(r => r.tri_score).length
    : 0;

  // Função para obter TRI da prova anterior
  const getPreviousTRI = (index: number): number | null => {
    if (index + 1 < results.length) {
      return results[index + 1].tri_score;
    }
    return null;
  };

  // Filtrar questões erradas
  const filteredWrongQuestions = useMemo(() => {
    if (!details?.studentWrongQuestions) return [];

    return details.studentWrongQuestions.filter(q => {
      const areaMatch = selectedAreaFilter === 'all' || q.area === selectedAreaFilter;
      const diffMatch = selectedDifficultyFilter === 'all' || q.difficulty === selectedDifficultyFilter;
      return areaMatch && diffMatch;
    });
  }, [details?.studentWrongQuestions, selectedAreaFilter, selectedDifficultyFilter]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-6xl mx-auto">
        {/* ========== HEADER ========== */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold">
              Olá, {profile?.name || 'Aluno'}! 👋
            </h1>
            <p className="text-gray-500 text-sm">
              {profile?.student_number && `Matrícula: ${profile.student_number}`}
              {profile?.turma && ` • Turma: ${profile.turma}`}
            </p>
          </div>
          <Button variant="outline" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Sair
          </Button>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <LoadingCard />
              <LoadingCard />
              <LoadingCard />
              <LoadingCard />
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-red-600">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Empty State */}
        {!loading && !error && results.length === 0 && (
          <Card>
            <CardContent className="pt-6 text-center">
              <Target className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold text-gray-700 mb-2">
                Nenhum resultado encontrado
              </h3>
              <p className="text-gray-500">
                Seus resultados aparecerão aqui após realizar provas.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Dashboard com Resultados */}
        {!loading && !error && ultimoResultado && (
          <div className="space-y-6">
            {/* Card Principal - Última Prova */}
            <Card className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
              <CardHeader>
                <CardDescription className="text-blue-100">Último Resultado</CardDescription>
                <CardTitle className="text-xl">
                  {ultimoResultado.exams?.title || 'Prova'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-4xl font-bold">
                      {ultimoResultado.tri_score?.toFixed(1) || '---'}
                    </div>
                    <div className="text-blue-100 text-sm">TRI Geral</div>
                  </div>
                  <div className="text-right">
                    <Badge className="bg-white/20 text-white border-white/30">
                      {classificarTRI(ultimoResultado.tri_score).emoji} {classificarTRI(ultimoResultado.tri_score).label}
                    </Badge>
                    <div className="text-blue-100 text-xs mt-2">
                      {new Date(ultimoResultado.created_at).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric'
                      })}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ========== SEÇÃO: DESEMPENHO POR ÁREA - IGUAL AO ADMIN ========== */}
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-600" />
                Desempenho por Área
                {details && (
                  <Badge variant="outline" className="ml-2">
                    <Users className="h-3 w-3 mr-1" />
                    {details.turmaSize} alunos na turma
                  </Badge>
                )}
              </h2>

              {details?.turmaStats ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <AreaTRICardAdmin
                    area="LC"
                    studentTRI={ultimoResultado.tri_lc}
                    turmaMin={details.turmaStats.LC.min}
                    turmaAvg={details.turmaStats.LC.avg}
                    turmaMax={details.turmaStats.LC.max}
                  />
                  <AreaTRICardAdmin
                    area="CH"
                    studentTRI={ultimoResultado.tri_ch}
                    turmaMin={details.turmaStats.CH.min}
                    turmaAvg={details.turmaStats.CH.avg}
                    turmaMax={details.turmaStats.CH.max}
                  />
                  <AreaTRICardAdmin
                    area="CN"
                    studentTRI={ultimoResultado.tri_cn}
                    turmaMin={details.turmaStats.CN.min}
                    turmaAvg={details.turmaStats.CN.avg}
                    turmaMax={details.turmaStats.CN.max}
                  />
                  <AreaTRICardAdmin
                    area="MT"
                    studentTRI={ultimoResultado.tri_mt}
                    turmaMin={details.turmaStats.MT.min}
                    turmaAvg={details.turmaStats.MT.avg}
                    turmaMax={details.turmaStats.MT.max}
                  />
                </div>
              ) : detailsLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <LoadingCard />
                  <LoadingCard />
                  <LoadingCard />
                  <LoadingCard />
                </div>
              ) : (
                // Fallback sem dados da turma
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {(['LC', 'CH', 'CN', 'MT'] as const).map(area => {
                    const config = AREA_CONFIG[area];
                    const tri = area === 'LC' ? ultimoResultado.tri_lc
                      : area === 'CH' ? ultimoResultado.tri_ch
                      : area === 'CN' ? ultimoResultado.tri_cn
                      : ultimoResultado.tri_mt;

                    return (
                      <Card key={area} className={`border-2 ${config.colors.border}`}>
                        <CardContent className="p-6">
                          <div className="space-y-4">
                            <div>
                              <h3 className="text-lg font-bold mb-1">{config.name}</h3>
                              <p className={`text-4xl font-bold ${config.colors.text}`}>
                                {tri?.toFixed(1) || '---'}
                              </p>
                              <p className="text-sm text-muted-foreground mt-1">TRI</p>
                            </div>
                            <div className="space-y-2">
                              <div className="relative h-3 bg-gray-200 rounded-full overflow-hidden">
                                <div className={`absolute top-0 left-0 h-full ${config.colors.bar} opacity-30 w-full`}></div>
                              </div>
                            </div>
                            <div className="pt-2 border-t border-border">
                              <p className="text-xs text-muted-foreground">Carregando estatísticas...</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ========== SEÇÃO: DISPERSÃO ACERTOS VS TRI ========== */}
            {details && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-blue-600" />
                    Sua Posição: Acertos vs TRI
                  </CardTitle>
                  <CardDescription>Relação entre número de acertos e nota TRI</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        type="number"
                        dataKey="acertos"
                        name="Acertos"
                        domain={[0, 'dataMax + 5']}
                        label={{ value: 'Número de Acertos', position: 'bottom', offset: 0 }}
                      />
                      <YAxis
                        type="number"
                        dataKey="tri"
                        name="TRI"
                        domain={[0, 'dataMax + 50']}
                        label={{ value: 'Nota TRI', angle: -90, position: 'insideLeft' }}
                      />
                      <ZAxis range={[100, 100]} />
                      <Tooltip
                        cursor={{ strokeDasharray: '3 3' }}
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="bg-white border rounded-lg shadow-lg p-3">
                                <p className="font-bold text-blue-600">{data.isStudent ? 'Você' : 'Colega'}</p>
                                <p className="text-sm">Acertos: {data.acertos}</p>
                                <p className="text-sm">TRI: {data.tri?.toFixed(1)}</p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      {/* Pontos dos colegas */}
                      <Scatter
                        name="Turma"
                        data={[
                          // Simular dados da turma baseado nas estatísticas
                          { acertos: ultimoResultado.correct_answers || 0, tri: ultimoResultado.tri_score || 0, isStudent: true }
                        ]}
                        fill="#3b82f6"
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* ========== SEÇÃO: ANÁLISE POR DIFICULDADE ========== */}
            {details?.difficultyStats && (
              <div>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-purple-600" />
                  Análise de Questões por Dificuldade
                </h2>

                {/* Cards de dificuldade */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <DifficultyCard difficulty="easy" stats={details.difficultyStats.easy} />
                  <DifficultyCard difficulty="medium" stats={details.difficultyStats.medium} />
                  <DifficultyCard difficulty="hard" stats={details.difficultyStats.hard} />
                </div>

                {/* Tabela de questões erradas */}
                {details.studentWrongQuestions.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                          Questões para Revisar ({filteredWrongQuestions.length})
                        </CardTitle>
                        <div className="flex gap-2">
                          <Select value={selectedAreaFilter} onValueChange={setSelectedAreaFilter}>
                            <SelectTrigger className="w-[130px] h-8 text-xs">
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
                            <SelectTrigger className="w-[130px] h-8 text-xs">
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
                    <CardContent>
                      <div className="max-h-[350px] overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[60px]">Nº</TableHead>
                              <TableHead>Conteúdo</TableHead>
                              <TableHead className="w-[90px]">Área</TableHead>
                              <TableHead className="w-[100px]">Dificuldade</TableHead>
                              <TableHead className="w-[120px] text-center">Sua / Correta</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredWrongQuestions.slice(0, 20).map((q) => (
                              <TableRow key={q.questionNumber}>
                                <TableCell className="font-medium">{q.questionNumber}</TableCell>
                                <TableCell className="text-sm text-gray-600 max-w-[250px] truncate" title={q.content}>
                                  {q.content || `Questão ${q.questionNumber}`}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-xs">
                                    {q.area}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <span className="text-xs">
                                    {q.difficulty === 'easy' ? '🟢 Fácil' : q.difficulty === 'medium' ? '🟡 Média' : '🔴 Difícil'}
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
                        {filteredWrongQuestions.length > 20 && (
                          <p className="text-xs text-gray-400 text-center mt-2">
                            Mostrando 20 de {filteredWrongQuestions.length} questões
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* ========== SEÇÃO: CONTEÚDOS PRIORITÁRIOS ========== */}
            {details?.topErrorContents && details.topErrorContents.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-5 w-5 text-red-600" />
                    Conteúdos Prioritários para Estudo
                  </CardTitle>
                  <CardDescription>Foque nos conteúdos com maior taxa de erro</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={Math.min(350, details.topErrorContents.length * 40 + 50)}>
                    <BarChart
                      data={details.topErrorContents.slice(0, 10).map(c => ({
                        name: c.content.length > 35 ? c.content.slice(0, 35) + '...' : c.content,
                        fullName: c.content,
                        erros: c.errors,
                        total: c.total,
                        percentage: c.total > 0 ? Math.round((c.errors / c.total) * 100) : 0,
                        area: c.area,
                      }))}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                      <YAxis dataKey="name" type="category" width={180} tick={{ fontSize: 11 }} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="bg-white border rounded-lg shadow-lg p-3 text-sm">
                                <p className="font-medium">{data.fullName}</p>
                                <p className="text-gray-500">Área: {data.area}</p>
                                <p className="text-red-600 font-bold">Erros: {data.erros}/{data.total} ({data.percentage}%)</p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar dataKey="percentage" radius={[0, 4, 4, 0]}>
                        {details.topErrorContents.slice(0, 10).map((entry, index) => {
                          const areaColors: Record<string, string> = {
                            LC: '#8b5cf6',
                            CH: '#f97316',
                            CN: '#22c55e',
                            MT: '#3b82f6',
                          };
                          return <Cell key={`cell-${index}`} fill={areaColors[entry.area] || '#ef4444'} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* ========== SEÇÃO: PLANO DE ESTUDOS PERSONALIZADO ========== */}
            {(studyPlan?.studyPlan && studyPlan.studyPlan.length > 0) && (
              <div>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <GraduationCap className="h-5 w-5 text-indigo-600" />
                  Plano de Estudos Personalizado
                </h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Baseado no seu desempenho TRI, preparamos conteúdos prioritários para você evoluir em cada área.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {studyPlan.studyPlan.map((plan) => {
                    const areaConfig = AREA_CONFIG[plan.area as keyof typeof AREA_CONFIG];
                    if (!areaConfig) return null;

                    return (
                      <Card key={plan.area} className={`border-2 ${areaConfig.colors.border}`}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base flex items-center gap-2">
                              <span className={areaConfig.colors.text}>{areaConfig.name}</span>
                            </CardTitle>
                            <Badge variant="outline" className="text-xs">
                              TRI: {plan.tri_atual?.toFixed(0) || '---'}
                            </Badge>
                          </div>
                          {plan.meta_proxima_faixa && plan.meta_proxima_faixa.pontos_necessarios > 0 && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                              <Lightbulb className="h-3 w-3 text-amber-500" />
                              <span>
                                Meta: +{plan.meta_proxima_faixa.pontos_necessarios} pontos para {plan.meta_proxima_faixa.proxima_faixa}
                              </span>
                            </div>
                          )}
                        </CardHeader>
                        <CardContent>
                          {plan.conteudos_prioritarios && plan.conteudos_prioritarios.length > 0 ? (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-muted-foreground mb-2">
                                Conteúdos para focar:
                              </p>
                              <ul className="space-y-1">
                                {plan.conteudos_prioritarios.slice(0, 5).map((conteudo, idx) => (
                                  <li key={idx} className="flex items-start gap-2 text-sm">
                                    <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                                    <span className="text-gray-700 dark:text-gray-300">
                                      {conteudo.conteudo}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                              {plan.conteudos_prioritarios.length > 5 && (
                                <p className="text-xs text-muted-foreground mt-2">
                                  +{plan.conteudos_prioritarios.length - 5} outros conteúdos
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              Parabéns! Você está em um ótimo nível nesta área.
                            </p>
                          )}

                          {/* Listas de Exercícios Recomendadas */}
                          {plan.listas_recomendadas && plan.listas_recomendadas.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                Listas de Exercícios:
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {plan.listas_recomendadas.map((lista) => (
                                  <a
                                    key={lista.id}
                                    href={lista.arquivo_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border
                                      ${areaConfig.colors.border} ${areaConfig.colors.text}
                                      hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors`}
                                  >
                                    <Download className="h-3 w-3" />
                                    {lista.titulo.replace(/Lista \d+ - /, '').replace(/\(\d+-\d+\)/, '').trim() || `Lista ${lista.ordem}`}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {studyPlanLoading && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <GraduationCap className="h-5 w-5 text-indigo-600" />
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

            {/* ========== SEÇÃO: GRÁFICO DE EVOLUÇÃO ========== */}
            {results.length >= 2 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-blue-600" />
                    Evolução do TRI por Área
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={350}>
                    <LineChart
                      data={[...results]
                        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                        .map((result) => ({
                          date: new Date(result.created_at).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit'
                          }),
                          fullDate: new Date(result.created_at).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: 'long',
                            year: 'numeric'
                          }),
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
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 12 }} />
                      <YAxis domain={[350, 700]} tick={{ fill: '#6b7280', fontSize: 12 }} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="bg-white border rounded-lg shadow-lg p-3">
                                <p className="font-semibold">{data.prova}</p>
                                <p className="text-sm text-gray-500 mb-2">{data.fullDate}</p>
                                <div className="space-y-1 text-sm">
                                  <p className="text-purple-600">LC: {data.LC?.toFixed(0) || '---'}</p>
                                  <p className="text-orange-600">CH: {data.CH?.toFixed(0) || '---'}</p>
                                  <p className="text-green-600">CN: {data.CN?.toFixed(0) || '---'}</p>
                                  <p className="text-blue-600">MT: {data.MT?.toFixed(0) || '---'}</p>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Legend />
                      <ReferenceLine y={550} stroke="#f59e0b" strokeDasharray="5 5" />
                      <Line type="monotone" dataKey="LC" name="Linguagens" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} connectNulls />
                      <Line type="monotone" dataKey="CH" name="Humanas" stroke="#f97316" strokeWidth={2} dot={{ r: 4 }} connectNulls />
                      <Line type="monotone" dataKey="CN" name="Natureza" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} connectNulls />
                      <Line type="monotone" dataKey="MT" name="Matemática" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : results.length === 1 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-blue-600" />
                    Evolução do TRI
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8">
                    <TrendingUp className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-semibold text-gray-700 mb-2">
                      Continue fazendo provas!
                    </h3>
                    <p className="text-gray-500">
                      O gráfico de evolução aparecerá quando você tiver 2 ou mais provas.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {/* ========== SEÇÃO: RESUMO DE ACERTOS ========== */}
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                Resumo de Acertos
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card className="border-green-200 bg-green-50">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-full bg-green-100">
                        <CheckCircle2 className="h-6 w-6 text-green-600" />
                      </div>
                      <div>
                        <div className="text-3xl font-bold text-green-700">
                          {ultimoResultado.correct_answers ?? '---'}
                        </div>
                        <div className="text-sm text-gray-600">Acertos</div>
                      </div>
                    </div>
                    {ultimoResultado.correct_answers !== null && ultimoResultado.answers && (
                      <Progress
                        value={(ultimoResultado.correct_answers / ultimoResultado.answers.length) * 100}
                        className="h-2 mt-3"
                      />
                    )}
                  </CardContent>
                </Card>

                <Card className="border-red-200 bg-red-50">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-full bg-red-100">
                        <XCircle className="h-6 w-6 text-red-600" />
                      </div>
                      <div>
                        <div className="text-3xl font-bold text-red-700">
                          {ultimoResultado.wrong_answers ?? '---'}
                        </div>
                        <div className="text-sm text-gray-600">Erros</div>
                      </div>
                    </div>
                    {ultimoResultado.wrong_answers !== null && ultimoResultado.answers && (
                      <Progress
                        value={(ultimoResultado.wrong_answers / ultimoResultado.answers.length) * 100}
                        className="h-2 mt-3 [&>div]:bg-red-500"
                      />
                    )}
                  </CardContent>
                </Card>

                <Card className="border-gray-200 bg-gray-50">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-full bg-gray-100">
                        <MinusCircle className="h-6 w-6 text-gray-600" />
                      </div>
                      <div>
                        <div className="text-3xl font-bold text-gray-700">
                          {ultimoResultado.blank_answers ?? '---'}
                        </div>
                        <div className="text-sm text-gray-600">Em Branco</div>
                      </div>
                    </div>
                    {ultimoResultado.blank_answers !== null && ultimoResultado.answers && (
                      <Progress
                        value={(ultimoResultado.blank_answers / ultimoResultado.answers.length) * 100}
                        className="h-2 mt-3 [&>div]:bg-gray-400"
                      />
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* ========== SEÇÃO: HISTÓRICO DE PROVAS ========== */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-5 w-5 text-purple-600" />
                  Histórico de Provas
                </CardTitle>
              </CardHeader>
              <CardContent>
                {results.length === 0 ? (
                  <div className="text-center py-8">
                    <Calendar className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <p className="text-gray-500">Seu histórico aparecerá aqui.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Prova</TableHead>
                        <TableHead className="text-center">Acertos</TableHead>
                        <TableHead className="text-center">TRI</TableHead>
                        <TableHead className="text-center">Evolução</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.map((result, index) => (
                        <TableRow key={result.id}>
                          <TableCell className="font-medium">
                            {new Date(result.created_at).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric'
                            })}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{result.exams?.title || 'Prova'}</span>
                              <span className="text-xs text-gray-500">{result.exams?.template_type || 'N/A'}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="font-medium text-green-600">{result.correct_answers ?? '-'}</span>
                            <span className="text-gray-400">/{result.answers?.length || '-'}</span>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge className={`${classificarTRI(result.tri_score).color}`}>
                              {result.tri_score?.toFixed(0) || '---'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <EvolutionIndicator current={result.tri_score} previous={getPreviousTRI(index)} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => handleViewDetails(result)}>
                              <Eye className="h-4 w-4 mr-1" />
                              Ver
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Resumo Geral */}
            {totalProvas > 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Resumo Geral</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-6">
                    <div>
                      <div className="text-2xl font-bold text-blue-600">{totalProvas}</div>
                      <div className="text-sm text-gray-500">Provas realizadas</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-green-600">{mediaTriGeral.toFixed(1)}</div>
                      <div className="text-sm text-gray-500">Média TRI Geral</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Dialog de Detalhes da Prova */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{selectedResult?.exams?.title || 'Detalhes da Prova'}</DialogTitle>
              <DialogDescription>
                {selectedResult && new Date(selectedResult.created_at).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric'
                })}
              </DialogDescription>
            </DialogHeader>

            {selectedResult && (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <div className="text-sm text-gray-500">TRI Geral</div>
                    <div className="text-3xl font-bold">{selectedResult.tri_score?.toFixed(1) || '---'}</div>
                  </div>
                  <Badge className={`${classificarTRI(selectedResult.tri_score).color} text-sm`}>
                    {classificarTRI(selectedResult.tri_score).emoji} {classificarTRI(selectedResult.tri_score).label}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {(['LC', 'CH', 'CN', 'MT'] as const).map(area => {
                    const tri = area === 'LC' ? selectedResult.tri_lc
                      : area === 'CH' ? selectedResult.tri_ch
                      : area === 'CN' ? selectedResult.tri_cn
                      : selectedResult.tri_mt;
                    return (
                      <div key={area} className="p-3 border rounded-lg">
                        <div className="text-sm text-gray-500 mb-1">{AREA_CONFIG[area].name}</div>
                        <div className={`text-xl font-bold ${AREA_CONFIG[area].colors.text}`}>
                          {tri?.toFixed(1) || '---'}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-around p-4 bg-gray-50 rounded-lg">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">{selectedResult.correct_answers ?? '-'}</div>
                    <div className="text-xs text-gray-500">Acertos</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-600">{selectedResult.wrong_answers ?? '-'}</div>
                    <div className="text-xs text-gray-500">Erros</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-600">{selectedResult.blank_answers ?? '-'}</div>
                    <div className="text-xs text-gray-500">Em Branco</div>
                  </div>
                </div>

                <div className="text-sm text-gray-500 space-y-1">
                  <div>Total: {selectedResult.answers?.length || '-'} questões</div>
                  <div>Tipo: {selectedResult.exams?.template_type || 'N/A'}</div>
                  {selectedResult.turma && <div>Turma: {selectedResult.turma}</div>}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
