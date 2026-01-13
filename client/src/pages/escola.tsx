import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, LogOut, Users, FileText, BarChart2, School,
  TrendingUp, TrendingDown, Minus, Trophy, AlertTriangle,
  Search, ChevronLeft, ChevronRight, Eye, X, Download,
  BookOpen, CheckCircle2, XCircle, Filter, FileSpreadsheet
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell, RadarChart, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, Radar, Legend
} from 'recharts';

// Types
interface DashboardStats {
  totalAlunos: number;
  totalProvas: number;
  mediaAcertos: number;
  totalTurmas: number;
  totalSeries: number;
}

interface TurmaRanking {
  turma: string;
  alunos: number;
  media: number;
  tri_lc: number | null;
  tri_ch: number | null;
  tri_cn: number | null;
  tri_mt: number | null;
}

interface AlunoDestaque {
  nome: string;
  matricula: string | null;
  turma: string | null;
  acertos: number;
}

interface DashboardData {
  stats: DashboardStats;
  turmaRanking: TurmaRanking[];
  desempenhoPorArea: {
    lc: number | null;
    ch: number | null;
    cn: number | null;
    mt: number | null;
  };
  topAlunos: AlunoDestaque[];
  atencao: AlunoDestaque[];
  series: string[];
  turmas: string[];
}

interface TurmaAluno {
  posicao: number;
  nome: string;
  matricula: string | null;
  acertos: number;
  tri_lc: number | null;
  tri_ch: number | null;
  tri_cn: number | null;
  tri_mt: number | null;
  comparacao: { acertos: string | null };
  prova: string;
  data: string;
}

interface TurmaAlunosData {
  turma: string;
  totalAlunos: number;
  mediaTurma: {
    acertos: number;
    lc: number | null;
    ch: number | null;
    cn: number | null;
    mt: number | null;
  };
  alunos: TurmaAluno[];
}

interface AlunoHistorico {
  aluno: { nome: string; matricula: string; turma: string };
  posicao: { atual: number; total: number };
  ultimoResultado: {
    acertos: number;
    tri_lc: number | null;
    tri_ch: number | null;
    tri_cn: number | null;
    tri_mt: number | null;
  };
  mediaTurma: { acertos: number; lc: number; ch: number; cn: number; mt: number };
  historico: Array<{
    id: string;
    prova: string;
    data: string;
    acertos: number;
    erros: number;
    brancos: number;
    tri_lc: number | null;
    tri_ch: number | null;
    tri_cn: number | null;
    tri_mt: number | null;
  }>;
  evolucao: {
    acertos: number;
    tri_lc: number;
    tri_ch: number;
    tri_cn: number;
    tri_mt: number;
  } | null;
  totalProvas: number;
}

interface StudentResult {
  id: string;
  student_name: string;
  student_number: string | null;
  turma: string | null;
  correct_answers: number | null;
  tri_lc: number | null;
  tri_ch: number | null;
  tri_cn: number | null;
  tri_mt: number | null;
  exam_title: string;
  created_at: string;
}

// Interfaces para relatório de downloads de listas
interface ListDownloadAluno {
  studentId: string;
  studentName: string;
  studentNumber: string | null;
  turma: string | null;
  downloaded: boolean;
  downloadedAt: string | null;
}

interface ListDownloadReport {
  listId: string;
  listTitle: string;
  area: string;
  triMin: number;
  triMax: number;
  totalAlunos: number;
  totalDownloads: number;
  percentDownloaded: number;
  alunos: ListDownloadAluno[];
}

interface ListDownloadSummary {
  totalListas: number;
  totalAlunos: number;
  mediaDownloads: number;
}

interface ListDownloadData {
  success: boolean;
  summary: ListDownloadSummary;
  report: ListDownloadReport[];
}

// Helper functions
function getComparacaoIcon(comparacao: string | null) {
  if (comparacao === 'acima') return <TrendingUp className="h-4 w-4 text-green-600" />;
  if (comparacao === 'abaixo') return <TrendingDown className="h-4 w-4 text-red-600" />;
  return <Minus className="h-4 w-4 text-gray-400" />;
}

function getPosicaoEmoji(posicao: number) {
  if (posicao === 1) return '🥇';
  if (posicao === 2) return '🥈';
  if (posicao === 3) return '🥉';
  return posicao.toString();
}

function getTriFaixaColor(tri: number | null): string {
  if (tri === null) return 'bg-gray-200';
  if (tri < 500) return 'bg-red-400';
  if (tri < 650) return 'bg-yellow-400';
  return 'bg-green-400';
}

function getTriFaixaLabel(tri: number | null): string {
  if (tri === null) return '-';
  if (tri < 500) return 'Baixo';
  if (tri < 650) return 'Médio';
  return 'Alto';
}

export default function EscolaPage() {
  const { profile, signOut } = useAuth();
  const { toast } = useToast();

  // Tab state
  const [activeTab, setActiveTab] = useState('visao-geral');

  // Dashboard state
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);

  // Results state
  const [results, setResults] = useState<StudentResult[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);

  // Filters
  const [selectedSerie, setSelectedSerie] = useState<string>('all');
  const [selectedTurma, setSelectedTurma] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Turma modal state
  const [selectedTurmaModal, setSelectedTurmaModal] = useState<string | null>(null);
  const [turmaAlunosData, setTurmaAlunosData] = useState<TurmaAlunosData | null>(null);
  const [loadingTurmaAlunos, setLoadingTurmaAlunos] = useState(false);

  // Aluno modal state
  const [selectedAlunoMatricula, setSelectedAlunoMatricula] = useState<string | null>(null);
  const [alunoHistorico, setAlunoHistorico] = useState<AlunoHistorico | null>(null);
  const [loadingAlunoHistorico, setLoadingAlunoHistorico] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // List downloads state
  const [listDownloadsData, setListDownloadsData] = useState<ListDownloadData | null>(null);
  const [loadingListDownloads, setLoadingListDownloads] = useState(false);
  const [listDownloadFilters, setListDownloadFilters] = useState({
    turma: 'all',
    area: 'all',
    onlyMissing: false,
  });
  const [expandedListId, setExpandedListId] = useState<string | null>(null);

  // Fetch dashboard data
  const fetchDashboard = useCallback(async () => {
    try {
      setLoadingDashboard(true);
      const response = await authFetch('/api/escola/dashboard');
      if (!response.ok) throw new Error('Erro ao buscar dashboard');
      const data = await response.json();
      setDashboardData(data);
    } catch (error: any) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    } finally {
      setLoadingDashboard(false);
    }
  }, [toast]);

  // Fetch results
  const fetchResults = useCallback(async () => {
    try {
      setLoadingResults(true);
      const response = await authFetch('/api/escola/results');
      if (!response.ok) throw new Error('Erro ao buscar resultados');
      const data = await response.json();
      setResults(data.results || []);
    } catch (error: any) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    } finally {
      setLoadingResults(false);
    }
  }, [toast]);

  // Fetch turma alunos
  const fetchTurmaAlunos = useCallback(async (turma: string) => {
    try {
      setLoadingTurmaAlunos(true);
      const response = await authFetch(`/api/escola/turmas/${encodeURIComponent(turma)}/alunos`);
      if (!response.ok) throw new Error('Erro ao buscar alunos da turma');
      const data = await response.json();
      setTurmaAlunosData(data);
    } catch (error: any) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    } finally {
      setLoadingTurmaAlunos(false);
    }
  }, [toast]);

  // Fetch aluno historico
  const fetchAlunoHistorico = useCallback(async (matricula: string) => {
    try {
      setLoadingAlunoHistorico(true);
      const response = await authFetch(`/api/escola/alunos/${encodeURIComponent(matricula)}/historico`);
      if (!response.ok) throw new Error('Erro ao buscar histórico do aluno');
      const data = await response.json();
      setAlunoHistorico(data);
    } catch (error: any) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    } finally {
      setLoadingAlunoHistorico(false);
    }
  }, [toast]);

  // Fetch list downloads report
  const fetchListDownloads = useCallback(async () => {
    try {
      setLoadingListDownloads(true);
      const params = new URLSearchParams();
      if (listDownloadFilters.turma !== 'all') params.append('turma', listDownloadFilters.turma);
      if (listDownloadFilters.area !== 'all') params.append('area', listDownloadFilters.area);
      if (listDownloadFilters.onlyMissing) params.append('onlyMissing', 'true');

      const response = await authFetch(`/api/coordinator/list-downloads?${params.toString()}`);
      if (!response.ok) throw new Error('Erro ao buscar relatório de downloads');
      const data = await response.json();
      setListDownloadsData(data);
    } catch (error: any) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    } finally {
      setLoadingListDownloads(false);
    }
  }, [toast, listDownloadFilters]);

  // Initial load
  useEffect(() => {
    fetchDashboard();
    fetchResults();
  }, [fetchDashboard, fetchResults]);

  // Load list downloads when tab changes to "listas"
  useEffect(() => {
    if (activeTab === 'listas') {
      fetchListDownloads();
    }
  }, [activeTab, fetchListDownloads]);

  // Load turma alunos when modal opens
  useEffect(() => {
    if (selectedTurmaModal) {
      fetchTurmaAlunos(selectedTurmaModal);
    } else {
      setTurmaAlunosData(null);
    }
  }, [selectedTurmaModal, fetchTurmaAlunos]);

  // Load aluno historico when modal opens
  useEffect(() => {
    if (selectedAlunoMatricula) {
      fetchAlunoHistorico(selectedAlunoMatricula);
    } else {
      setAlunoHistorico(null);
    }
  }, [selectedAlunoMatricula, fetchAlunoHistorico]);

  // Extract série number from turma name (e.g., "EM3VA" → "3", "3ª Série A" → "3")
  const extractSerieNumber = (turma: string | null): string | null => {
    if (!turma) return null;
    // Pattern 1: EM followed by number (e.g., EM3VA, EM1VB)
    const emPattern = turma.match(/^EM(\d)/i);
    if (emPattern) return emPattern[1];
    // Pattern 2: Number followed by ª/º Série/Ano
    const seriePattern = turma.match(/^(\d+)[ªº]?\s*[Ss]érie/i);
    if (seriePattern) return seriePattern[1];
    const anoPattern = turma.match(/^(\d+)[ªº]?\s*[Aa]no/i);
    if (anoPattern) return anoPattern[1];
    // Pattern 3: Just starts with a number
    const numPattern = turma.match(/^(\d)/);
    if (numPattern) return numPattern[1];
    return null;
  };

  // Extract série for display (e.g., "EM3VA" → "3ª Série")
  const extractSerie = (turma: string | null): string => {
    if (!turma) return '';
    const serieNum = extractSerieNumber(turma);
    if (serieNum) return `${serieNum}ª Série`;
    return turma;
  };

  // Helper: Check if turma matches allowed series
  const isTurmaAllowed = (turma: string | null): boolean => {
    const allowedSeries = profile?.allowed_series;
    if (!allowedSeries || allowedSeries.length === 0) return true;

    const serieNumber = extractSerieNumber(turma);
    if (!serieNumber) return false;

    return allowedSeries.some(allowed => {
      const allowedNumber = allowed.match(/(\d)/)?.[1];
      return allowedNumber === serieNumber;
    });
  };

  // Filter results
  const filteredResults = results.filter(r => {
    if (selectedSerie !== 'all' && extractSerie(r.turma) !== selectedSerie) return false;
    if (selectedTurma !== 'all' && r.turma !== selectedTurma) return false;
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      if (!r.student_name?.toLowerCase().includes(search) &&
          !r.student_number?.toLowerCase().includes(search)) {
        return false;
      }
    }
    return true;
  });

  // Paginate results
  const totalPages = Math.ceil(filteredResults.length / itemsPerPage);
  const paginatedResults = filteredResults.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Helper to filter out null/empty turmas
  const isValidTurma = (turma: string | null): turma is string => {
    return turma !== null && turma !== 'null' && turma.trim() !== '' && turma !== 'Sem turma';
  };

  // Get unique series from results (excluding null/invalid), filtered by allowed series
  const availableSeries = [...new Set(
    results
      .map(r => extractSerie(r.turma))
      .filter(s => s && s !== 'Sem série' && s !== 'null')
      .filter(s => isTurmaAllowed(s))
  )].sort();

  // Get turmas for selected serie (excluding null/invalid), filtered by allowed series
  const availableTurmas = selectedSerie === 'all'
    ? [...new Set(results.map(r => r.turma).filter(isValidTurma).filter(t => isTurmaAllowed(t)))].sort()
    : [...new Set(results.filter(r => extractSerie(r.turma) === selectedSerie).map(r => r.turma).filter(isValidTurma).filter(t => isTurmaAllowed(t)))].sort();

  if (loadingDashboard && !dashboardData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <School className="h-8 w-8 text-blue-600" />
            <div>
              <h1 className="text-xl font-bold">Portal da Escola</h1>
              <p className="text-sm text-gray-500">
                {profile?.name} - Coordenador(a)
                {profile?.allowed_series && profile.allowed_series.length > 0 && (
                  <span className="ml-2 text-blue-600">
                    ({profile.allowed_series.join(', ')})
                  </span>
                )}
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Sair
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total de Alunos</CardDescription>
              <CardTitle className="text-3xl">
                <Users className="h-5 w-5 inline mr-2 text-blue-600" />
                {dashboardData?.stats.totalAlunos || 0}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Provas Realizadas</CardDescription>
              <CardTitle className="text-3xl">
                <FileText className="h-5 w-5 inline mr-2 text-green-600" />
                {dashboardData?.stats.totalProvas || 0}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Média de Acertos</CardDescription>
              <CardTitle className="text-3xl">
                <BarChart2 className="h-5 w-5 inline mr-2 text-purple-600" />
                {dashboardData?.stats.mediaAcertos?.toFixed(1) || '-'}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Turmas / Séries</CardDescription>
              <CardTitle className="text-3xl">
                {dashboardData?.stats.totalTurmas || 0} / {dashboardData?.stats.totalSeries || 0}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-5 max-w-2xl">
            <TabsTrigger value="visao-geral">Visão Geral</TabsTrigger>
            <TabsTrigger value="resultados">Resultados</TabsTrigger>
            <TabsTrigger value="turmas">Turmas</TabsTrigger>
            <TabsTrigger value="alunos">Alunos</TabsTrigger>
            <TabsTrigger value="listas">Listas</TabsTrigger>
          </TabsList>

          {/* TAB: Visão Geral */}
          <TabsContent value="visao-geral" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Ranking de Turmas */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-yellow-500" />
                    Ranking por Turma
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {dashboardData?.turmaRanking.map((turma, index) => (
                    <div key={turma.turma || `ranking-${index}`} className="flex items-center gap-3">
                      <span className="w-8 text-lg font-bold text-gray-500">
                        {index + 1}º
                      </span>
                      <div className="flex-1">
                        <div className="flex justify-between mb-1">
                          <span className="font-medium">{turma.turma || 'Sem turma'}</span>
                          <span className="text-sm text-gray-500">
                            {turma.media.toFixed(1)} acertos
                          </span>
                        </div>
                        <Progress
                          value={(turma.media / 90) * 100}
                          className="h-2"
                        />
                      </div>
                      <Badge variant="outline">{turma.alunos} alunos</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Gráfico de Barras - TRI por Área */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart2 className="h-5 w-5 text-blue-500" />
                    TRI Médio por Área
                  </CardTitle>
                  <CardDescription>Desempenho médio em cada área do conhecimento</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart
                      data={[
                        { area: 'LC', value: dashboardData?.desempenhoPorArea.lc || 0, label: 'Linguagens' },
                        { area: 'CH', value: dashboardData?.desempenhoPorArea.ch || 0, label: 'C. Humanas' },
                        { area: 'CN', value: dashboardData?.desempenhoPorArea.cn || 0, label: 'C. Natureza' },
                        { area: 'MT', value: dashboardData?.desempenhoPorArea.mt || 0, label: 'Matemática' },
                      ]}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="area" tick={{ fontSize: 12 }} />
                      <YAxis domain={[0, 1000]} tick={{ fontSize: 11 }} />
                      <RechartsTooltip
                        formatter={(value: number, name, props) => [`${value.toFixed(0)}`, props.payload.label]}
                        contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                      />
                      <Bar dataKey="value" name="TRI" radius={[4, 4, 0, 0]}>
                        <Cell fill="#3b82f6" />
                        <Cell fill="#10b981" />
                        <Cell fill="#8b5cf6" />
                        <Cell fill="#f97316" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    Escala TRI: Baixo (&lt;500) | Médio (500-650) | Alto (&gt;650)
                  </p>
                </CardContent>
              </Card>

              {/* Gráfico Radar - TRI por Área */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart2 className="h-5 w-5 text-purple-500" />
                    Radar: Perfil de Desempenho
                  </CardTitle>
                  <CardDescription>Visualização comparativa das áreas</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <RadarChart
                      data={[
                        { area: 'LC', value: dashboardData?.desempenhoPorArea.lc || 0, fullMark: 1000 },
                        { area: 'CH', value: dashboardData?.desempenhoPorArea.ch || 0, fullMark: 1000 },
                        { area: 'CN', value: dashboardData?.desempenhoPorArea.cn || 0, fullMark: 1000 },
                        { area: 'MT', value: dashboardData?.desempenhoPorArea.mt || 0, fullMark: 1000 },
                      ]}
                    >
                      <PolarGrid />
                      <PolarAngleAxis dataKey="area" tick={{ fontSize: 12 }} />
                      <PolarRadiusAxis angle={90} domain={[0, 1000]} tick={{ fontSize: 10 }} />
                      <Radar
                        name="TRI"
                        dataKey="value"
                        stroke="#8b5cf6"
                        fill="#8b5cf6"
                        fillOpacity={0.5}
                      />
                      <RechartsTooltip
                        formatter={(value: number) => [`${value.toFixed(0)}`, 'TRI Médio']}
                        contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Gráfico de Barras - TRI por Turma */}
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart2 className="h-5 w-5 text-green-500" />
                    TRI Médio por Turma
                  </CardTitle>
                  <CardDescription>Comparativo de desempenho TRI entre as turmas</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={dashboardData?.turmaRanking.map(t => ({
                        turma: t.turma || 'Sem turma',
                        lc: t.tri_lc || 0,
                        ch: t.tri_ch || 0,
                        cn: t.tri_cn || 0,
                        mt: t.tri_mt || 0,
                        media: ((t.tri_lc || 0) + (t.tri_ch || 0) + (t.tri_cn || 0) + (t.tri_mt || 0)) / 4,
                      })) || []}
                      layout="vertical"
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" domain={[0, 1000]} tick={{ fontSize: 11 }} />
                      <YAxis dataKey="turma" type="category" tick={{ fontSize: 11 }} width={80} />
                      <RechartsTooltip
                        formatter={(value: number, name) => [`${value.toFixed(0)}`, name]}
                        contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                      />
                      <Legend />
                      <Bar dataKey="lc" name="LC" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="ch" name="CH" fill="#10b981" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="cn" name="CN" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="mt" name="MT" fill="#f97316" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Top 5 Alunos */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-green-600">
                    <TrendingUp className="h-5 w-5" />
                    Top 5 Alunos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {dashboardData?.topAlunos.map((aluno, index) => (
                      <div key={index} className="flex items-center justify-between p-2 rounded hover:bg-gray-50">
                        <div className="flex items-center gap-3">
                          <span className="text-lg">{getPosicaoEmoji(index + 1)}</span>
                          <div>
                            <p className="font-medium">{aluno.nome}</p>
                            <p className="text-xs text-gray-500">{aluno.turma || 'Sem turma'}</p>
                          </div>
                        </div>
                        <Badge className="bg-green-100 text-green-800">
                          {aluno.acertos} acertos
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Alunos que precisam de atenção */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-orange-600">
                    <AlertTriangle className="h-5 w-5" />
                    Atenção Necessária
                  </CardTitle>
                  <CardDescription>Alunos abaixo de 50% de acertos</CardDescription>
                </CardHeader>
                <CardContent>
                  {dashboardData?.atencao.length === 0 ? (
                    <p className="text-center text-gray-500 py-4">
                      Nenhum aluno nesta faixa
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {dashboardData?.atencao.map((aluno, index) => (
                        <div key={index} className="flex items-center justify-between p-2 rounded hover:bg-gray-50">
                          <div>
                            <p className="font-medium">{aluno.nome}</p>
                            <p className="text-xs text-gray-500">{aluno.turma || 'Sem turma'}</p>
                          </div>
                          <Badge variant="destructive">
                            {aluno.acertos} acertos
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* TAB: Resultados */}
          <TabsContent value="resultados">
            <Card>
              <CardHeader>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <CardTitle>Resultados dos Alunos</CardTitle>
                    <CardDescription>
                      {filteredResults.length} resultado(s) encontrado(s)
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Select value={selectedSerie} onValueChange={(v) => { setSelectedSerie(v); setSelectedTurma('all'); setCurrentPage(1); }}>
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="Série" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas séries</SelectItem>
                        {availableSeries.map(serie => (
                          <SelectItem key={serie} value={serie}>{serie}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={selectedTurma} onValueChange={(v) => { setSelectedTurma(v); setCurrentPage(1); }}>
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="Turma" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas turmas</SelectItem>
                        {availableTurmas.map(turma => (
                          <SelectItem key={turma} value={turma!}>{turma}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loadingResults ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : filteredResults.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">
                    Nenhum resultado encontrado
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Aluno</TableHead>
                            <TableHead>Matrícula</TableHead>
                            <TableHead>Turma</TableHead>
                            <TableHead>Prova</TableHead>
                            <TableHead className="text-center">Acertos</TableHead>
                            <TableHead className="text-center">LC</TableHead>
                            <TableHead className="text-center">CH</TableHead>
                            <TableHead className="text-center">CN</TableHead>
                            <TableHead className="text-center">MT</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paginatedResults.map((result) => (
                            <TableRow key={result.id}>
                              <TableCell className="font-medium">
                                {result.student_name}
                              </TableCell>
                              <TableCell>{result.student_number || '-'}</TableCell>
                              <TableCell>
                                <Badge variant="outline">
                                  {result.turma && result.turma !== 'null' ? result.turma : 'Sem turma'}
                                </Badge>
                              </TableCell>
                              <TableCell>{result.exam_title}</TableCell>
                              <TableCell className="text-center font-medium">
                                {result.correct_answers ?? '-'}
                              </TableCell>
                              <TableCell className="text-center">
                                {result.tri_lc?.toFixed(0) || '-'}
                              </TableCell>
                              <TableCell className="text-center">
                                {result.tri_ch?.toFixed(0) || '-'}
                              </TableCell>
                              <TableCell className="text-center">
                                {result.tri_cn?.toFixed(0) || '-'}
                              </TableCell>
                              <TableCell className="text-center">
                                {result.tri_mt?.toFixed(0) || '-'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4">
                        <p className="text-sm text-gray-500">
                          Página {currentPage} de {totalPages}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(p => p - 1)}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={currentPage === totalPages}
                            onClick={() => setCurrentPage(p => p + 1)}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB: Turmas */}
          <TabsContent value="turmas">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {dashboardData?.turmaRanking
                .filter(turma => isTurmaAllowed(turma.turma))
                .map((turma, index) => (
                <Card key={turma.turma || `turma-${index}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{turma.turma || 'Sem turma'}</CardTitle>
                      <Badge variant="secondary">{turma.alunos} alunos</Badge>
                    </div>
                    <CardDescription>
                      Posição: {index + 1}º no ranking
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-2xl font-bold">
                      Média: {turma.media.toFixed(1)} acertos
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-xs text-center">
                      <div>
                        <p className="text-gray-500">LC</p>
                        <p className="font-medium">{turma.tri_lc?.toFixed(0) || '-'}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">CH</p>
                        <p className="font-medium">{turma.tri_ch?.toFixed(0) || '-'}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">CN</p>
                        <p className="font-medium">{turma.tri_cn?.toFixed(0) || '-'}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">MT</p>
                        <p className="font-medium">{turma.tri_mt?.toFixed(0) || '-'}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => setSelectedTurmaModal(turma.turma)}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Ver Alunos
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          window.open(`/api/escola/turmas/${encodeURIComponent(turma.turma)}/export-excel`, '_blank');
                        }}
                        title="Exportar para Excel"
                      >
                        <FileSpreadsheet className="h-4 w-4 text-green-600" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* TAB: Alunos */}
          <TabsContent value="alunos">
            <Card>
              <CardHeader>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <CardTitle>Lista de Alunos</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        placeholder="Buscar por nome ou matrícula..."
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                        className="pl-10 w-64"
                      />
                    </div>
                    <Select value={selectedSerie} onValueChange={(v) => { setSelectedSerie(v); setSelectedTurma('all'); setCurrentPage(1); }}>
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="Série" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas séries</SelectItem>
                        {availableSeries.map(serie => (
                          <SelectItem key={serie} value={serie}>{serie}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={selectedTurma} onValueChange={(v) => { setSelectedTurma(v); setCurrentPage(1); }}>
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="Turma" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas turmas</SelectItem>
                        {availableTurmas.map(turma => (
                          <SelectItem key={turma} value={turma!}>{turma}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      onClick={() => {
                        const params = new URLSearchParams();
                        if (selectedTurma && selectedTurma !== 'all') params.set('turma', selectedTurma);
                        window.open(`/api/admin/export-credentials?${params.toString()}`, '_blank');
                      }}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Exportar Credenciais
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loadingResults ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Aluno</TableHead>
                            <TableHead>Matrícula</TableHead>
                            <TableHead>Turma</TableHead>
                            <TableHead className="text-center">Último Acertos</TableHead>
                            <TableHead className="text-center">Ações</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paginatedResults.map((result) => (
                            <TableRow key={result.id}>
                              <TableCell className="font-medium">
                                {result.student_name}
                              </TableCell>
                              <TableCell>{result.student_number || '-'}</TableCell>
                              <TableCell>
                                <Badge variant="outline">
                                  {result.turma && result.turma !== 'null' ? result.turma : 'Sem turma'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-center font-medium">
                                {result.correct_answers ?? '-'}
                              </TableCell>
                              <TableCell className="text-center">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => result.student_number && setSelectedAlunoMatricula(result.student_number)}
                                  disabled={!result.student_number}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4">
                        <p className="text-sm text-gray-500">
                          Página {currentPage} de {totalPages}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(p => p - 1)}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={currentPage === totalPages}
                            onClick={() => setCurrentPage(p => p + 1)}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB: Listas de Exercícios */}
          <TabsContent value="listas" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-blue-500" />
                  Relatório de Downloads de Listas
                </CardTitle>
                <CardDescription>
                  Acompanhe quais alunos baixaram as listas de exercícios recomendadas
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Filtros */}
                <div className="flex flex-wrap gap-4 mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-gray-500" />
                    <span className="text-sm font-medium">Filtros:</span>
                  </div>
                  <Select
                    value={listDownloadFilters.turma}
                    onValueChange={(value) => setListDownloadFilters(f => ({ ...f, turma: value }))}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Turma" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as turmas</SelectItem>
                      {dashboardData?.turmas.map(t => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={listDownloadFilters.area}
                    onValueChange={(value) => setListDownloadFilters(f => ({ ...f, area: value }))}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Área" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as áreas</SelectItem>
                      <SelectItem value="LC">Linguagens (LC)</SelectItem>
                      <SelectItem value="CH">Humanas (CH)</SelectItem>
                      <SelectItem value="CN">Natureza (CN)</SelectItem>
                      <SelectItem value="MT">Matemática (MT)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant={listDownloadFilters.onlyMissing ? "default" : "outline"}
                    size="sm"
                    onClick={() => setListDownloadFilters(f => ({ ...f, onlyMissing: !f.onlyMissing }))}
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Só quem não baixou
                  </Button>
                </div>

                {loadingListDownloads ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                  </div>
                ) : listDownloadsData ? (
                  <>
                    {/* Resumo */}
                    <div className="grid grid-cols-3 gap-4 mb-6">
                      <div className="text-center p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                        <div className="text-2xl font-bold text-blue-600">{listDownloadsData.summary.totalListas}</div>
                        <div className="text-sm text-muted-foreground">Listas Disponíveis</div>
                      </div>
                      <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                        <div className="text-2xl font-bold text-green-600">{listDownloadsData.summary.totalAlunos}</div>
                        <div className="text-sm text-muted-foreground">Alunos</div>
                      </div>
                      <div className="text-center p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                        <div className="text-2xl font-bold text-purple-600">{listDownloadsData.summary.mediaDownloads}%</div>
                        <div className="text-sm text-muted-foreground">Média de Downloads</div>
                      </div>
                    </div>

                    {/* Lista de listas com relatório */}
                    <div className="space-y-3">
                      {listDownloadsData.report.map((list) => (
                        <div key={list.listId} className="border rounded-lg overflow-hidden">
                          {/* Header da lista (clicável) */}
                          <div
                            className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                            onClick={() => setExpandedListId(expandedListId === list.listId ? null : list.listId)}
                          >
                            <div className="flex items-center gap-3">
                              <Badge variant="outline" className={
                                list.area === 'LC' ? 'border-blue-500 text-blue-500' :
                                list.area === 'CH' ? 'border-yellow-500 text-yellow-500' :
                                list.area === 'CN' ? 'border-green-500 text-green-500' :
                                'border-red-500 text-red-500'
                              }>
                                {list.area}
                              </Badge>
                              <div>
                                <div className="font-medium">{list.listTitle}</div>
                                <div className="text-xs text-muted-foreground">TRI {list.triMin}-{list.triMax}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <div className="flex items-center gap-2">
                                  <span className={`text-lg font-bold ${
                                    list.percentDownloaded >= 70 ? 'text-green-600' :
                                    list.percentDownloaded >= 40 ? 'text-yellow-600' :
                                    'text-red-600'
                                  }`}>
                                    {list.percentDownloaded}%
                                  </span>
                                  <Progress value={list.percentDownloaded} className="w-24 h-2" />
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {list.totalDownloads}/{list.totalAlunos} alunos
                                </div>
                              </div>
                              <ChevronRight className={`h-5 w-5 transition-transform ${expandedListId === list.listId ? 'rotate-90' : ''}`} />
                            </div>
                          </div>

                          {/* Detalhes dos alunos (expandido) */}
                          {expandedListId === list.listId && (
                            <div className="border-t bg-gray-50 dark:bg-gray-800/50 p-4">
                              {list.alunos.length === 0 ? (
                                <p className="text-center text-muted-foreground py-4">
                                  {listDownloadFilters.onlyMissing
                                    ? 'Todos os alunos já baixaram esta lista!'
                                    : 'Nenhum aluno encontrado'}
                                </p>
                              ) : (
                                <div className="max-h-64 overflow-y-auto">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Aluno</TableHead>
                                        <TableHead>Matrícula</TableHead>
                                        <TableHead>Turma</TableHead>
                                        <TableHead>Data do Download</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {list.alunos.map((aluno) => (
                                        <TableRow key={aluno.studentId}>
                                          <TableCell>
                                            {aluno.downloaded ? (
                                              <CheckCircle2 className="h-5 w-5 text-green-500" />
                                            ) : (
                                              <XCircle className="h-5 w-5 text-red-500" />
                                            )}
                                          </TableCell>
                                          <TableCell className="font-medium">{aluno.studentName}</TableCell>
                                          <TableCell>{aluno.studentNumber || '-'}</TableCell>
                                          <TableCell>{aluno.turma || '-'}</TableCell>
                                          <TableCell>
                                            {aluno.downloadedAt
                                              ? new Date(aluno.downloadedAt).toLocaleDateString('pt-BR', {
                                                  day: '2-digit',
                                                  month: '2-digit',
                                                  year: 'numeric',
                                                  hour: '2-digit',
                                                  minute: '2-digit',
                                                })
                                              : '-'}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {listDownloadsData.report.length === 0 && (
                      <div className="text-center py-12 text-muted-foreground">
                        <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>Nenhuma lista encontrada com os filtros selecionados</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Selecione filtros para ver o relatório</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Modal: Ver Alunos da Turma */}
      <Dialog open={!!selectedTurmaModal} onOpenChange={(open) => !open && setSelectedTurmaModal(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>{turmaAlunosData?.turma} - {turmaAlunosData?.totalAlunos} alunos</DialogTitle>
                <DialogDescription>
                  Média da turma: {turmaAlunosData?.mediaTurma.acertos.toFixed(1)} acertos |
                  LC: {turmaAlunosData?.mediaTurma.lc?.toFixed(0) || '-'} |
                  CH: {turmaAlunosData?.mediaTurma.ch?.toFixed(0) || '-'} |
                  CN: {turmaAlunosData?.mediaTurma.cn?.toFixed(0) || '-'} |
                  MT: {turmaAlunosData?.mediaTurma.mt?.toFixed(0) || '-'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {loadingTurmaAlunos ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Aluno</TableHead>
                    <TableHead>Matrícula</TableHead>
                    <TableHead className="text-center">Acertos</TableHead>
                    <TableHead className="text-center">LC</TableHead>
                    <TableHead className="text-center">CH</TableHead>
                    <TableHead className="text-center">CN</TableHead>
                    <TableHead className="text-center">MT</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {turmaAlunosData?.alunos.map((aluno) => (
                    <TableRow key={aluno.matricula || aluno.nome}>
                      <TableCell className="font-bold text-lg">
                        {getPosicaoEmoji(aluno.posicao)}
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {aluno.nome}
                          {getComparacaoIcon(aluno.comparacao.acertos)}
                        </div>
                      </TableCell>
                      <TableCell>{aluno.matricula || '-'}</TableCell>
                      <TableCell className="text-center font-medium">
                        {aluno.acertos ?? '-'}
                      </TableCell>
                      <TableCell className="text-center">{aluno.tri_lc?.toFixed(0) || '-'}</TableCell>
                      <TableCell className="text-center">{aluno.tri_ch?.toFixed(0) || '-'}</TableCell>
                      <TableCell className="text-center">{aluno.tri_cn?.toFixed(0) || '-'}</TableCell>
                      <TableCell className="text-center">{aluno.tri_mt?.toFixed(0) || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="pt-4 border-t text-xs text-gray-500">
            Legenda: <TrendingUp className="h-3 w-3 inline text-green-600" /> Acima da média |
            <Minus className="h-3 w-3 inline text-gray-400 mx-1" /> Na média |
            <TrendingDown className="h-3 w-3 inline text-red-600" /> Abaixo da média
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Detalhes do Aluno */}
      <Dialog open={!!selectedAlunoMatricula} onOpenChange={(open) => !open && setSelectedAlunoMatricula(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{alunoHistorico?.aluno.nome}</DialogTitle>
            <DialogDescription>
              Matrícula: {alunoHistorico?.aluno.matricula} |
              Turma: {alunoHistorico?.aluno.turma} |
              Posição: {alunoHistorico?.posicao.atual}º de {alunoHistorico?.posicao.total} alunos
            </DialogDescription>
          </DialogHeader>

          {loadingAlunoHistorico ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : alunoHistorico && (
            <div className="flex-1 overflow-auto space-y-6">
              {/* Comparativo com Turma */}
              <div>
                <h4 className="font-medium mb-3">Desempenho vs Turma</h4>
                <div className="space-y-2">
                  {[
                    { label: 'LC', aluno: alunoHistorico.ultimoResultado.tri_lc, turma: alunoHistorico.mediaTurma.lc },
                    { label: 'CH', aluno: alunoHistorico.ultimoResultado.tri_ch, turma: alunoHistorico.mediaTurma.ch },
                    { label: 'CN', aluno: alunoHistorico.ultimoResultado.tri_cn, turma: alunoHistorico.mediaTurma.cn },
                    { label: 'MT', aluno: alunoHistorico.ultimoResultado.tri_mt, turma: alunoHistorico.mediaTurma.mt },
                  ].map(area => {
                    const diff = (area.aluno || 0) - area.turma;
                    return (
                      <div key={area.label} className="flex items-center gap-3">
                        <span className="w-8 font-medium">{area.label}:</span>
                        <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${diff >= 0 ? 'bg-green-500' : 'bg-yellow-500'}`}
                            style={{ width: `${Math.min(((area.aluno || 0) / 1000) * 100, 100)}%` }}
                          />
                        </div>
                        <span className="w-16 text-right font-medium">{area.aluno?.toFixed(0) || '-'}</span>
                        <span className="w-24 text-xs text-gray-500">
                          (turma: {area.turma.toFixed(0)})
                        </span>
                        <span className={`w-12 text-xs font-medium ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {diff >= 0 ? '+' : ''}{diff.toFixed(0)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Histórico de Provas */}
              <div>
                <h4 className="font-medium mb-3">Histórico de Provas ({alunoHistorico.totalProvas})</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Prova</TableHead>
                      <TableHead className="text-center">Acertos</TableHead>
                      <TableHead className="text-center">LC</TableHead>
                      <TableHead className="text-center">CH</TableHead>
                      <TableHead className="text-center">CN</TableHead>
                      <TableHead className="text-center">MT</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alunoHistorico.historico.map((prova) => (
                      <TableRow key={prova.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{prova.prova}</p>
                            <p className="text-xs text-gray-500">
                              {new Date(prova.data).toLocaleDateString('pt-BR')}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-center font-medium">{prova.acertos}</TableCell>
                        <TableCell className="text-center">{prova.tri_lc?.toFixed(0) || '-'}</TableCell>
                        <TableCell className="text-center">{prova.tri_ch?.toFixed(0) || '-'}</TableCell>
                        <TableCell className="text-center">{prova.tri_cn?.toFixed(0) || '-'}</TableCell>
                        <TableCell className="text-center">{prova.tri_mt?.toFixed(0) || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Evolução */}
              {alunoHistorico.evolucao && (
                <div className="p-4 bg-gray-50 rounded-lg">
                  <h4 className="font-medium mb-2">Evolução</h4>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span>
                      Acertos: <span className={alunoHistorico.evolucao.acertos >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {alunoHistorico.evolucao.acertos >= 0 ? '+' : ''}{alunoHistorico.evolucao.acertos}
                      </span>
                    </span>
                    <span>
                      LC: <span className={alunoHistorico.evolucao.tri_lc >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {alunoHistorico.evolucao.tri_lc >= 0 ? '+' : ''}{alunoHistorico.evolucao.tri_lc.toFixed(0)}
                      </span>
                    </span>
                    <span>
                      CH: <span className={alunoHistorico.evolucao.tri_ch >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {alunoHistorico.evolucao.tri_ch >= 0 ? '+' : ''}{alunoHistorico.evolucao.tri_ch.toFixed(0)}
                      </span>
                    </span>
                    <span>
                      CN: <span className={alunoHistorico.evolucao.tri_cn >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {alunoHistorico.evolucao.tri_cn >= 0 ? '+' : ''}{alunoHistorico.evolucao.tri_cn.toFixed(0)}
                      </span>
                    </span>
                    <span>
                      MT: <span className={alunoHistorico.evolucao.tri_mt >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {alunoHistorico.evolucao.tri_mt >= 0 ? '+' : ''}{alunoHistorico.evolucao.tri_mt.toFixed(0)}
                      </span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
