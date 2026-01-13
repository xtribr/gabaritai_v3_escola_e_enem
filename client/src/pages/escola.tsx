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
  Loader2, Users, FileText, BarChart2, School,
  TrendingUp, TrendingDown, Minus, Trophy, AlertTriangle,
  Search, ChevronLeft, ChevronRight, Eye, Download,
  BookOpen, CheckCircle2, XCircle, Filter, FileSpreadsheet,
  LayoutDashboard, ClipboardList, GraduationCap
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell, RadarChart, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, Radar, Legend
} from 'recharts';

// ============================================================================
// TYPES
// ============================================================================

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

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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
// TURMA CARD COMPONENT - NexLink Style
// ============================================================================

interface TurmaCardProps {
  turma: TurmaRanking;
  index: number;
  onViewAlunos: () => void;
  onExportExcel: () => void;
}

function TurmaCard({ turma, index, onViewAlunos, onExportExcel }: TurmaCardProps) {
  const gradients = [
    'from-[#33B5E5] to-[#1E9FCC]',
    'from-[#F26A4B] to-[#E04E2D]',
    'from-emerald-500 to-teal-600',
    'from-indigo-500 to-violet-600',
    'from-pink-500 to-rose-600',
    'from-amber-500 to-orange-600',
  ];
  const gradient = gradients[index % gradients.length];

  return (
    <div
      className="rounded-2xl border-2 border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1 overflow-hidden"
      style={{
        animation: `fadeSlideUp 0.5s ease-out ${index * 100}ms both`,
      }}
    >
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg`}>
              <span className="text-white text-sm font-bold">{index + 1}º</span>
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white">{turma.turma || 'Sem turma'}</h3>
              <p className="text-xs text-gray-500">{turma.alunos} alunos</p>
            </div>
          </div>
          <Badge variant="secondary" className="text-lg font-bold px-3 py-1">
            {turma.media.toFixed(1)}
          </Badge>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-4">
          {(['LC', 'CH', 'CN', 'MT'] as const).map((area) => {
            const config = AREA_CONFIG[area];
            const value = area === 'LC' ? turma.tri_lc
              : area === 'CH' ? turma.tri_ch
              : area === 'CN' ? turma.tri_cn
              : turma.tri_mt;

            return (
              <div key={area} className={`p-2 rounded-lg ${config.bgLight} text-center`}>
                <p className={`text-xs font-medium ${config.text}`}>{area}</p>
                <p className={`text-sm font-bold ${config.text}`}>{value?.toFixed(0) || '-'}</p>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 border-[#33B5E5] text-[#33B5E5] hover:bg-[#33B5E5] hover:text-white"
            onClick={onViewAlunos}
          >
            <Eye className="h-4 w-4 mr-2" />
            Ver Alunos
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="border-emerald-500 text-emerald-500 hover:bg-emerald-500 hover:text-white"
            onClick={onExportExcel}
            title="Exportar Excel"
          >
            <FileSpreadsheet className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// RANKING CARD COMPONENT
// ============================================================================

interface RankingCardProps {
  turmas: TurmaRanking[];
}

function RankingCard({ turmas }: RankingCardProps) {
  return (
    <div className="rounded-2xl border-2 border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center shadow-lg">
            <Trophy className="w-5 h-5 text-white" />
          </div>
          <h3 className="font-bold text-lg text-gray-900 dark:text-white">Ranking por Turma</h3>
        </div>

        <div className="space-y-4">
          {turmas.slice(0, 5).map((turma, index) => (
            <div key={turma.turma || `ranking-${index}`} className="flex items-center gap-3">
              <span className="w-8 text-lg font-bold text-gray-400">
                {getPosicaoEmoji(index + 1)}
              </span>
              <div className="flex-1">
                <div className="flex justify-between mb-1">
                  <span className="font-medium text-gray-900 dark:text-white">{turma.turma || 'Sem turma'}</span>
                  <span className="text-sm text-gray-500">{turma.media.toFixed(1)} acertos</span>
                </div>
                <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#33B5E5] to-[#1E9FCC] rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((turma.media / 90) * 100, 100)}%` }}
                  />
                </div>
              </div>
              <Badge variant="outline" className="text-xs">{turma.alunos}</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TOP ALUNOS CARD
// ============================================================================

interface TopAlunosCardProps {
  alunos: AlunoDestaque[];
  type: 'top' | 'atencao';
}

function TopAlunosCard({ alunos, type }: TopAlunosCardProps) {
  const isTop = type === 'top';
  const gradient = isTop ? 'from-emerald-500 to-teal-600' : 'from-orange-500 to-red-500';
  const Icon = isTop ? TrendingUp : AlertTriangle;
  const title = isTop ? 'Top 5 Alunos' : 'Atenção Necessária';
  const subtitle = isTop ? 'Melhores desempenhos' : 'Abaixo de 50% de acertos';

  return (
    <div className="rounded-2xl border-2 border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-gray-900 dark:text-white">{title}</h3>
            <p className="text-xs text-gray-500">{subtitle}</p>
          </div>
        </div>

        {alunos.length === 0 ? (
          <p className="text-center text-gray-500 py-6">
            {isTop ? 'Nenhum aluno encontrado' : 'Nenhum aluno nesta faixa'}
          </p>
        ) : (
          <div className="space-y-2 mt-4">
            {alunos.map((aluno, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isTop && <span className="text-lg">{getPosicaoEmoji(index + 1)}</span>}
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{aluno.nome}</p>
                    <p className="text-xs text-gray-500">{aluno.turma || 'Sem turma'}</p>
                  </div>
                </div>
                <Badge className={isTop ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'}>
                  {aluno.acertos} acertos
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function EscolaPage() {
  const { profile } = useAuth();
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

  // Download Excel com autenticação
  const downloadTurmaExcel = useCallback(async (turma: string) => {
    try {
      toast({ title: 'Gerando Excel...', description: `Exportando dados da turma ${turma}` });
      const response = await authFetch(`/api/escola/turmas/${encodeURIComponent(turma)}/export-excel`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao exportar');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `turma_${turma.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({ title: 'Excel exportado!', description: `Arquivo da turma ${turma} baixado com sucesso` });
    } catch (error: any) {
      toast({ title: 'Erro ao exportar', description: error.message, variant: 'destructive' });
    }
  }, [toast]);

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

  // Extract série number from turma name
  const extractSerieNumber = (turma: string | null): string | null => {
    if (!turma) return null;
    const emPattern = turma.match(/^EM(\d)/i);
    if (emPattern) return emPattern[1];
    const seriePattern = turma.match(/^(\d+)[ªº]?\s*[Ss]érie/i);
    if (seriePattern) return seriePattern[1];
    const anoPattern = turma.match(/^(\d+)[ªº]?\s*[Aa]no/i);
    if (anoPattern) return anoPattern[1];
    const numPattern = turma.match(/^(\d)/);
    if (numPattern) return numPattern[1];
    return null;
  };

  const extractSerie = (turma: string | null): string => {
    if (!turma) return '';
    const serieNum = extractSerieNumber(turma);
    if (serieNum) return `${serieNum}ª Série`;
    return turma;
  };

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

  const isValidTurma = (turma: string | null): turma is string => {
    return turma !== null && turma !== 'null' && turma.trim() !== '' && turma !== 'Sem turma';
  };

  const availableSeries = [...new Set(
    results
      .map(r => extractSerie(r.turma))
      .filter(s => s && s !== 'Sem série' && s !== 'null')
      .filter(s => isTurmaAllowed(s))
  )].sort();

  const availableTurmas = selectedSerie === 'all'
    ? [...new Set(results.map(r => r.turma).filter(isValidTurma).filter(t => isTurmaAllowed(t)))].sort()
    : [...new Set(results.filter(r => extractSerie(r.turma) === selectedSerie).map(r => r.turma).filter(isValidTurma).filter(t => isTurmaAllowed(t)))].sort();

  // Loading state
  if (loadingDashboard && !dashboardData) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
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
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#33B5E5] to-[#1E9FCC] flex items-center justify-center shadow-xl animate-pulse">
              <School className="w-8 h-8 text-white" />
            </div>
            <Loader2 className="h-8 w-8 animate-spin text-[#33B5E5] mx-auto" />
            <p className="text-gray-500 mt-2">Carregando dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
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

      {/* Header Sticky */}
      <header className="sticky top-0 z-50 bg-white/95 dark:bg-gray-900/95 backdrop-blur shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-4 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#33B5E5] to-[#1E9FCC] flex items-center justify-center shadow-lg shadow-cyan-500/30">
                <School className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-lg text-gray-900 dark:text-white hidden sm:block">Portal da Escola</span>
            </div>
            <div className="h-8 w-px bg-gray-200 dark:bg-gray-700 hidden sm:block" />
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-gray-900 dark:text-white">{profile?.name}</p>
              <p className="text-xs text-gray-500">
                Coordenador(a)
                {profile?.allowed_series && profile.allowed_series.length > 0 && (
                  <span className="ml-1 text-[#33B5E5]">
                    ({profile.allowed_series.join(', ')})
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Badge variant="outline" className="border-[#33B5E5] text-[#33B5E5] hidden md:flex">
              <GraduationCap className="w-3 h-3 mr-1" />
              {dashboardData?.stats.totalTurmas || 0} turmas
            </Badge>
          </div>
        </div>
        {/* Gradient bar */}
        <div className="h-1 bg-gradient-to-r from-[#33B5E5] via-[#F26A4B] to-[#33B5E5]" />
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-8 space-y-8">
        {/* Stat Cards */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Total de Alunos"
            value={dashboardData?.stats.totalAlunos || 0}
            subtitle="Alunos cadastrados"
            icon={Users}
            gradient="from-[#33B5E5] to-[#1E9FCC]"
            delay={0}
          />
          <StatCard
            title="Provas Realizadas"
            value={dashboardData?.stats.totalProvas || 0}
            subtitle="Simulados aplicados"
            icon={FileText}
            gradient="from-emerald-500 to-teal-600"
            delay={100}
          />
          <StatCard
            title="Média de Acertos"
            value={dashboardData?.stats.mediaAcertos?.toFixed(1) || '-'}
            subtitle="Média geral"
            icon={BarChart2}
            gradient="from-indigo-500 to-violet-600"
            delay={200}
          />
          <StatCard
            title="Turmas / Séries"
            value={`${dashboardData?.stats.totalTurmas || 0} / ${dashboardData?.stats.totalSeries || 0}`}
            subtitle="Organização escolar"
            icon={School}
            gradient="from-[#F26A4B] to-[#E04E2D]"
            delay={300}
          />
        </section>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-gray-100 dark:bg-gray-800 p-1.5 rounded-xl inline-flex">
            <TabsTrigger
              value="visao-geral"
              className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-900 data-[state=active]:text-[#33B5E5] data-[state=active]:shadow-sm rounded-lg px-4 py-2 transition-all"
            >
              <LayoutDashboard className="w-4 h-4 mr-2" />
              Visão Geral
            </TabsTrigger>
            <TabsTrigger
              value="resultados"
              className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-900 data-[state=active]:text-[#33B5E5] data-[state=active]:shadow-sm rounded-lg px-4 py-2 transition-all"
            >
              <ClipboardList className="w-4 h-4 mr-2" />
              Resultados
            </TabsTrigger>
            <TabsTrigger
              value="turmas"
              className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-900 data-[state=active]:text-[#33B5E5] data-[state=active]:shadow-sm rounded-lg px-4 py-2 transition-all"
            >
              <GraduationCap className="w-4 h-4 mr-2" />
              Turmas
            </TabsTrigger>
            <TabsTrigger
              value="alunos"
              className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-900 data-[state=active]:text-[#33B5E5] data-[state=active]:shadow-sm rounded-lg px-4 py-2 transition-all"
            >
              <Users className="w-4 h-4 mr-2" />
              Alunos
            </TabsTrigger>
            <TabsTrigger
              value="listas"
              className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-900 data-[state=active]:text-[#33B5E5] data-[state=active]:shadow-sm rounded-lg px-4 py-2 transition-all"
            >
              <BookOpen className="w-4 h-4 mr-2" />
              Listas
            </TabsTrigger>
          </TabsList>

          {/* TAB: Visão Geral */}
          <TabsContent value="visao-geral" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Ranking de Turmas */}
              <RankingCard turmas={dashboardData?.turmaRanking || []} />

              {/* Gráfico TRI por Área */}
              <div className="rounded-2xl border-2 border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#33B5E5] to-[#1E9FCC] flex items-center justify-center shadow-lg">
                      <BarChart2 className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-gray-900 dark:text-white">TRI Médio por Área</h3>
                      <p className="text-xs text-gray-500">Desempenho médio por área do conhecimento</p>
                    </div>
                  </div>

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
                        contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '12px' }}
                      />
                      <Bar dataKey="value" name="TRI" radius={[8, 8, 0, 0]}>
                        <Cell fill={XTRI_COLORS.cyan} />
                        <Cell fill={XTRI_COLORS.orange} />
                        <Cell fill="#10b981" />
                        <Cell fill="#6366f1" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Radar Chart */}
              <div className="rounded-2xl border-2 border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg">
                      <BarChart2 className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-gray-900 dark:text-white">Perfil de Desempenho</h3>
                      <p className="text-xs text-gray-500">Visualização comparativa das áreas</p>
                    </div>
                  </div>

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
                        stroke={XTRI_COLORS.cyan}
                        fill={XTRI_COLORS.cyan}
                        fillOpacity={0.4}
                      />
                      <RechartsTooltip
                        formatter={(value: number) => [`${value.toFixed(0)}`, 'TRI Médio']}
                        contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '12px' }}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* TRI por Turma */}
              <div className="rounded-2xl border-2 border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg overflow-hidden lg:col-span-2">
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
                      <BarChart2 className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-gray-900 dark:text-white">TRI Médio por Turma</h3>
                      <p className="text-xs text-gray-500">Comparativo de desempenho entre turmas</p>
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={dashboardData?.turmaRanking.map(t => ({
                        turma: t.turma || 'Sem turma',
                        lc: t.tri_lc || 0,
                        ch: t.tri_ch || 0,
                        cn: t.tri_cn || 0,
                        mt: t.tri_mt || 0,
                      })) || []}
                      layout="vertical"
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" domain={[0, 1000]} tick={{ fontSize: 11 }} />
                      <YAxis dataKey="turma" type="category" tick={{ fontSize: 11 }} width={80} />
                      <RechartsTooltip
                        formatter={(value: number, name) => [`${value.toFixed(0)}`, name]}
                        contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '12px' }}
                      />
                      <Legend />
                      <Bar dataKey="lc" name="LC" fill={XTRI_COLORS.cyan} radius={[0, 4, 4, 0]} />
                      <Bar dataKey="ch" name="CH" fill={XTRI_COLORS.orange} radius={[0, 4, 4, 0]} />
                      <Bar dataKey="cn" name="CN" fill="#10b981" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="mt" name="MT" fill="#6366f1" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Top 5 Alunos */}
              <TopAlunosCard alunos={dashboardData?.topAlunos || []} type="top" />

              {/* Alunos Atenção */}
              <TopAlunosCard alunos={dashboardData?.atencao || []} type="atencao" />
            </div>
          </TabsContent>

          {/* TAB: Resultados */}
          <TabsContent value="resultados">
            <div className="rounded-2xl border-2 border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
              <div className="p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Resultados dos Alunos</h2>
                    <p className="text-sm text-gray-500">{filteredResults.length} resultado(s) encontrado(s)</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Select value={selectedSerie} onValueChange={(v) => { setSelectedSerie(v); setSelectedTurma('all'); setCurrentPage(1); }}>
                      <SelectTrigger className="w-40 border-[#33B5E5]/30 focus:ring-[#33B5E5]">
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
                      <SelectTrigger className="w-40 border-[#33B5E5]/30 focus:ring-[#33B5E5]">
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

                {loadingResults ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-[#33B5E5]" />
                  </div>
                ) : filteredResults.length === 0 ? (
                  <p className="text-center text-gray-500 py-12">Nenhum resultado encontrado</p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-gray-50 dark:bg-gray-800">
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
                            <TableRow key={result.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                              <TableCell className="font-medium">{result.student_name}</TableCell>
                              <TableCell>{result.student_number || '-'}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="border-[#33B5E5]/30">
                                  {result.turma && result.turma !== 'null' ? result.turma : 'Sem turma'}
                                </Badge>
                              </TableCell>
                              <TableCell>{result.exam_title}</TableCell>
                              <TableCell className="text-center font-bold">{result.correct_answers ?? '-'}</TableCell>
                              <TableCell className="text-center text-cyan-600">{result.tri_lc?.toFixed(0) || '-'}</TableCell>
                              <TableCell className="text-center text-orange-600">{result.tri_ch?.toFixed(0) || '-'}</TableCell>
                              <TableCell className="text-center text-emerald-600">{result.tri_cn?.toFixed(0) || '-'}</TableCell>
                              <TableCell className="text-center text-indigo-600">{result.tri_mt?.toFixed(0) || '-'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-6 pt-4 border-t">
                        <p className="text-sm text-gray-500">Página {currentPage} de {totalPages}</p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(p => p - 1)}
                            className="border-[#33B5E5]/30 hover:bg-[#33B5E5] hover:text-white"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={currentPage === totalPages}
                            onClick={() => setCurrentPage(p => p + 1)}
                            className="border-[#33B5E5]/30 hover:bg-[#33B5E5] hover:text-white"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </TabsContent>

          {/* TAB: Turmas */}
          <TabsContent value="turmas">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {dashboardData?.turmaRanking
                .filter(turma => isTurmaAllowed(turma.turma))
                .map((turma, index) => (
                  <TurmaCard
                    key={turma.turma || `turma-${index}`}
                    turma={turma}
                    index={index}
                    onViewAlunos={() => setSelectedTurmaModal(turma.turma)}
                    onExportExcel={() => downloadTurmaExcel(turma.turma)}
                  />
                ))}
            </div>
          </TabsContent>

          {/* TAB: Alunos */}
          <TabsContent value="alunos">
            <div className="rounded-2xl border-2 border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
              <div className="p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Lista de Alunos</h2>
                  <div className="flex flex-wrap gap-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        placeholder="Buscar por nome ou matrícula..."
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                        className="pl-10 w-64 border-[#33B5E5]/30 focus:ring-[#33B5E5]"
                      />
                    </div>
                    <Select value={selectedSerie} onValueChange={(v) => { setSelectedSerie(v); setSelectedTurma('all'); setCurrentPage(1); }}>
                      <SelectTrigger className="w-40 border-[#33B5E5]/30">
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
                      <SelectTrigger className="w-40 border-[#33B5E5]/30">
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
                      className="border-[#33B5E5] text-[#33B5E5] hover:bg-[#33B5E5] hover:text-white"
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

                {loadingResults ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-[#33B5E5]" />
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-gray-50 dark:bg-gray-800">
                            <TableHead>Aluno</TableHead>
                            <TableHead>Matrícula</TableHead>
                            <TableHead>Turma</TableHead>
                            <TableHead className="text-center">Último Acertos</TableHead>
                            <TableHead className="text-center">Ações</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paginatedResults.map((result) => (
                            <TableRow key={result.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                              <TableCell className="font-medium">{result.student_name}</TableCell>
                              <TableCell>{result.student_number || '-'}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="border-[#33B5E5]/30">
                                  {result.turma && result.turma !== 'null' ? result.turma : 'Sem turma'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-center font-bold">{result.correct_answers ?? '-'}</TableCell>
                              <TableCell className="text-center">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => result.student_number && setSelectedAlunoMatricula(result.student_number)}
                                  disabled={!result.student_number}
                                  className="text-[#33B5E5] hover:bg-[#33B5E5]/10"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-6 pt-4 border-t">
                        <p className="text-sm text-gray-500">Página {currentPage} de {totalPages}</p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(p => p - 1)}
                            className="border-[#33B5E5]/30 hover:bg-[#33B5E5] hover:text-white"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={currentPage === totalPages}
                            onClick={() => setCurrentPage(p => p + 1)}
                            className="border-[#33B5E5]/30 hover:bg-[#33B5E5] hover:text-white"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </TabsContent>

          {/* TAB: Listas */}
          <TabsContent value="listas" className="space-y-6">
            <div className="rounded-2xl border-2 border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
              <div className="p-6">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#33B5E5] to-[#1E9FCC] flex items-center justify-center shadow-lg">
                    <BookOpen className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-gray-900 dark:text-white">Relatório de Downloads de Listas</h3>
                    <p className="text-xs text-gray-500">Acompanhe quais alunos baixaram as listas de exercícios</p>
                  </div>
                </div>

                {/* Filtros */}
                <div className="flex flex-wrap gap-4 mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-gray-500" />
                    <span className="text-sm font-medium">Filtros:</span>
                  </div>
                  <Select
                    value={listDownloadFilters.turma}
                    onValueChange={(value) => setListDownloadFilters(f => ({ ...f, turma: value }))}
                  >
                    <SelectTrigger className="w-40 border-[#33B5E5]/30">
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
                    <SelectTrigger className="w-40 border-[#33B5E5]/30">
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
                    className={listDownloadFilters.onlyMissing ? 'bg-[#F26A4B] hover:bg-[#E04E2D]' : 'border-[#F26A4B] text-[#F26A4B] hover:bg-[#F26A4B] hover:text-white'}
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Só quem não baixou
                  </Button>
                </div>

                {loadingListDownloads ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-[#33B5E5]" />
                  </div>
                ) : listDownloadsData ? (
                  <>
                    {/* Resumo */}
                    <div className="grid grid-cols-3 gap-4 mb-6">
                      <div className="text-center p-4 bg-cyan-50 dark:bg-cyan-900/20 rounded-xl border border-cyan-200 dark:border-cyan-800">
                        <div className="text-2xl font-bold text-cyan-600">{listDownloadsData.summary.totalListas}</div>
                        <div className="text-sm text-gray-500">Listas Disponíveis</div>
                      </div>
                      <div className="text-center p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800">
                        <div className="text-2xl font-bold text-emerald-600">{listDownloadsData.summary.totalAlunos}</div>
                        <div className="text-sm text-gray-500">Alunos</div>
                      </div>
                      <div className="text-center p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-200 dark:border-indigo-800">
                        <div className="text-2xl font-bold text-indigo-600">{listDownloadsData.summary.mediaDownloads}%</div>
                        <div className="text-sm text-gray-500">Média de Downloads</div>
                      </div>
                    </div>

                    {/* Lista de listas */}
                    <div className="space-y-3">
                      {listDownloadsData.report.map((list) => {
                        const areaConfig = AREA_CONFIG[list.area as keyof typeof AREA_CONFIG] || AREA_CONFIG.LC;
                        return (
                          <div key={list.listId} className="border-2 border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
                            <div
                              className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                              onClick={() => setExpandedListId(expandedListId === list.listId ? null : list.listId)}
                            >
                              <div className="flex items-center gap-3">
                                <Badge variant="outline" className={`${areaConfig.border} ${areaConfig.text}`}>
                                  {list.area}
                                </Badge>
                                <div>
                                  <div className="font-medium text-gray-900 dark:text-white">{list.listTitle}</div>
                                  <div className="text-xs text-gray-500">TRI {list.triMin}-{list.triMax}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  <div className="flex items-center gap-2">
                                    <span className={`text-lg font-bold ${
                                      list.percentDownloaded >= 70 ? 'text-emerald-600' :
                                      list.percentDownloaded >= 40 ? 'text-amber-600' :
                                      'text-red-600'
                                    }`}>
                                      {list.percentDownloaded}%
                                    </span>
                                    <Progress value={list.percentDownloaded} className="w-24 h-2" />
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {list.totalDownloads}/{list.totalAlunos} alunos
                                  </div>
                                </div>
                                <ChevronRight className={`h-5 w-5 text-gray-400 transition-transform ${expandedListId === list.listId ? 'rotate-90' : ''}`} />
                              </div>
                            </div>

                            {expandedListId === list.listId && (
                              <div className="border-t bg-gray-50 dark:bg-gray-800/50 p-4">
                                {list.alunos.length === 0 ? (
                                  <p className="text-center text-gray-500 py-4">
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
                                                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
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
                        );
                      })}
                    </div>

                    {listDownloadsData.report.length === 0 && (
                      <div className="text-center py-12">
                        <BookOpen className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                        <p className="text-gray-500">Nenhuma lista encontrada com os filtros selecionados</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12">
                    <BookOpen className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p className="text-gray-500">Selecione filtros para ver o relatório</p>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Modal: Ver Alunos da Turma */}
      <Dialog open={!!selectedTurmaModal} onOpenChange={(open) => !open && setSelectedTurmaModal(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#33B5E5] to-[#1E9FCC] flex items-center justify-center">
                    <GraduationCap className="w-4 h-4 text-white" />
                  </div>
                  {turmaAlunosData?.turma} - {turmaAlunosData?.totalAlunos} alunos
                </DialogTitle>
                <DialogDescription className="mt-1">
                  Média: {turmaAlunosData?.mediaTurma.acertos.toFixed(1)} acertos |
                  LC: {turmaAlunosData?.mediaTurma.lc?.toFixed(0) || '-'} |
                  CH: {turmaAlunosData?.mediaTurma.ch?.toFixed(0) || '-'} |
                  CN: {turmaAlunosData?.mediaTurma.cn?.toFixed(0) || '-'} |
                  MT: {turmaAlunosData?.mediaTurma.mt?.toFixed(0) || '-'}
                </DialogDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-emerald-500 text-emerald-500 hover:bg-emerald-500 hover:text-white"
                onClick={() => downloadTurmaExcel(selectedTurmaModal || '')}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Excel
              </Button>
            </div>
          </DialogHeader>

          {loadingTurmaAlunos ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-[#33B5E5]" />
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 dark:bg-gray-800">
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
                    <TableRow key={aluno.matricula || aluno.nome} className="hover:bg-gray-50 dark:hover:bg-gray-800">
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
                      <TableCell className="text-center font-bold">{aluno.acertos ?? '-'}</TableCell>
                      <TableCell className="text-center text-cyan-600">{aluno.tri_lc?.toFixed(0) || '-'}</TableCell>
                      <TableCell className="text-center text-orange-600">{aluno.tri_ch?.toFixed(0) || '-'}</TableCell>
                      <TableCell className="text-center text-emerald-600">{aluno.tri_cn?.toFixed(0) || '-'}</TableCell>
                      <TableCell className="text-center text-indigo-600">{aluno.tri_mt?.toFixed(0) || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="pt-4 border-t text-xs text-gray-500 flex items-center gap-4">
            <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3 text-green-600" /> Acima da média</span>
            <span className="flex items-center gap-1"><Minus className="h-3 w-3 text-gray-400" /> Na média</span>
            <span className="flex items-center gap-1"><TrendingDown className="h-3 w-3 text-red-600" /> Abaixo da média</span>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Detalhes do Aluno */}
      <Dialog open={!!selectedAlunoMatricula} onOpenChange={(open) => !open && setSelectedAlunoMatricula(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#33B5E5] to-[#1E9FCC] flex items-center justify-center">
                <Users className="w-4 h-4 text-white" />
              </div>
              {alunoHistorico?.aluno.nome}
            </DialogTitle>
            <DialogDescription>
              Matrícula: {alunoHistorico?.aluno.matricula} |
              Turma: {alunoHistorico?.aluno.turma} |
              Posição: {alunoHistorico?.posicao.atual}º de {alunoHistorico?.posicao.total} alunos
            </DialogDescription>
          </DialogHeader>

          {loadingAlunoHistorico ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-[#33B5E5]" />
            </div>
          ) : alunoHistorico && (
            <div className="flex-1 overflow-auto space-y-6">
              {/* Comparativo com Turma */}
              <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
                <h4 className="font-bold mb-4 text-gray-900 dark:text-white">Desempenho vs Turma</h4>
                <div className="space-y-3">
                  {[
                    { label: 'LC', aluno: alunoHistorico.ultimoResultado.tri_lc, turma: alunoHistorico.mediaTurma.lc, color: 'bg-cyan-500' },
                    { label: 'CH', aluno: alunoHistorico.ultimoResultado.tri_ch, turma: alunoHistorico.mediaTurma.ch, color: 'bg-orange-500' },
                    { label: 'CN', aluno: alunoHistorico.ultimoResultado.tri_cn, turma: alunoHistorico.mediaTurma.cn, color: 'bg-emerald-500' },
                    { label: 'MT', aluno: alunoHistorico.ultimoResultado.tri_mt, turma: alunoHistorico.mediaTurma.mt, color: 'bg-indigo-500' },
                  ].map(area => {
                    const diff = (area.aluno || 0) - area.turma;
                    return (
                      <div key={area.label} className="flex items-center gap-3">
                        <span className="w-8 font-bold text-gray-700 dark:text-gray-300">{area.label}:</span>
                        <div className="flex-1 h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${area.color} rounded-full transition-all duration-500`}
                            style={{ width: `${Math.min(((area.aluno || 0) / 1000) * 100, 100)}%` }}
                          />
                        </div>
                        <span className="w-16 text-right font-bold">{area.aluno?.toFixed(0) || '-'}</span>
                        <span className="w-24 text-xs text-gray-500">(turma: {area.turma.toFixed(0)})</span>
                        <span className={`w-14 text-xs font-bold ${diff >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {diff >= 0 ? '+' : ''}{diff.toFixed(0)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Histórico de Provas */}
              <div>
                <h4 className="font-bold mb-4 text-gray-900 dark:text-white">Histórico de Provas ({alunoHistorico.totalProvas})</h4>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50 dark:bg-gray-800">
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
                      <TableRow key={prova.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                        <TableCell>
                          <div>
                            <p className="font-medium">{prova.prova}</p>
                            <p className="text-xs text-gray-500">
                              {new Date(prova.data).toLocaleDateString('pt-BR')}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-center font-bold">{prova.acertos}</TableCell>
                        <TableCell className="text-center text-cyan-600">{prova.tri_lc?.toFixed(0) || '-'}</TableCell>
                        <TableCell className="text-center text-orange-600">{prova.tri_ch?.toFixed(0) || '-'}</TableCell>
                        <TableCell className="text-center text-emerald-600">{prova.tri_cn?.toFixed(0) || '-'}</TableCell>
                        <TableCell className="text-center text-indigo-600">{prova.tri_mt?.toFixed(0) || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Evolução */}
              {alunoHistorico.evolucao && (
                <div className="p-4 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 rounded-xl">
                  <h4 className="font-bold mb-3 text-gray-900 dark:text-white">Evolução</h4>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span className="flex items-center gap-1">
                      Acertos:
                      <span className={`font-bold ${alunoHistorico.evolucao.acertos >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {alunoHistorico.evolucao.acertos >= 0 ? '+' : ''}{alunoHistorico.evolucao.acertos}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      LC:
                      <span className={`font-bold ${alunoHistorico.evolucao.tri_lc >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {alunoHistorico.evolucao.tri_lc >= 0 ? '+' : ''}{alunoHistorico.evolucao.tri_lc.toFixed(0)}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      CH:
                      <span className={`font-bold ${alunoHistorico.evolucao.tri_ch >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {alunoHistorico.evolucao.tri_ch >= 0 ? '+' : ''}{alunoHistorico.evolucao.tri_ch.toFixed(0)}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      CN:
                      <span className={`font-bold ${alunoHistorico.evolucao.tri_cn >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {alunoHistorico.evolucao.tri_cn >= 0 ? '+' : ''}{alunoHistorico.evolucao.tri_cn.toFixed(0)}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      MT:
                      <span className={`font-bold ${alunoHistorico.evolucao.tri_mt >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
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
