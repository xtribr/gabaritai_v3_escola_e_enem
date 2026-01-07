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
  LogOut, TrendingUp, TrendingDown, Minus, BookOpen, Brain, Calculator, Leaf,
  Target, CheckCircle2, XCircle, MinusCircle, History, Eye, Calendar
} from 'lucide-react';
import { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
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

// Função para classificar TRI
const classificarTRI = (tri: number | null): { label: string; color: string; emoji: string } => {
  if (!tri || tri === 0) return { label: 'Não calculado', color: 'bg-gray-100 text-gray-800', emoji: '⚪' };
  if (tri < 450) return { label: 'Crítico', color: 'bg-red-100 text-red-800', emoji: '🔴' };
  if (tri < 550) return { label: 'Abaixo da média', color: 'bg-orange-100 text-orange-800', emoji: '🟠' };
  if (tri < 650) return { label: 'Na média', color: 'bg-yellow-100 text-yellow-800', emoji: '🟡' };
  if (tri < 750) return { label: 'Acima da média', color: 'bg-green-100 text-green-800', emoji: '🟢' };
  return { label: 'Excelente', color: 'bg-blue-100 text-blue-800', emoji: '🔵' };
};

// Componente de Card de Loading
function LoadingCard() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-20 mb-2" />
        <Skeleton className="h-3 w-32" />
      </CardContent>
    </Card>
  );
}

// Componente de Card TRI por Área
function AreaTRICard({
  area,
  label,
  icon: Icon,
  tri,
  color
}: {
  area: string;
  label: string;
  icon: React.ElementType;
  tri: number | null;
  color: string;
}) {
  const classificacao = classificarTRI(tri);
  const progressValue = tri ? Math.min(((tri - 200) / 800) * 100, 100) : 0;

  return (
    <Card className="relative overflow-hidden">
      <div className={`absolute top-0 left-0 w-1 h-full ${color}`} />
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-gray-500" />
          <CardTitle className="text-sm font-medium text-gray-600">{label}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold mb-1">
          {tri ? tri.toFixed(1) : '---'}
        </div>
        <Progress value={progressValue} className="h-1.5 mb-2" />
        <Badge className={`${classificacao.color} text-xs`}>
          {classificacao.emoji} {classificacao.label}
        </Badge>
      </CardContent>
    </Card>
  );
}

// Componente de Evolução (comparação com prova anterior)
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

export default function StudentDashboard() {
  const { profile, signOut } = useAuth();
  const [results, setResults] = useState<StudentResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<StudentResult | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

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

  // Função para obter TRI da prova anterior (para mostrar evolução)
  const getPreviousTRI = (index: number): number | null => {
    if (index + 1 < results.length) {
      return results[index + 1].tri_score;
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
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
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
            {/* Última Prova Info */}
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

            {/* Cards TRI por Área */}
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-600" />
                Desempenho por Área
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <AreaTRICard
                  area="LC"
                  label="Linguagens"
                  icon={BookOpen}
                  tri={ultimoResultado.tri_lc}
                  color="bg-purple-500"
                />
                <AreaTRICard
                  area="CH"
                  label="Humanas"
                  icon={Brain}
                  tri={ultimoResultado.tri_ch}
                  color="bg-orange-500"
                />
                <AreaTRICard
                  area="CN"
                  label="Natureza"
                  icon={Leaf}
                  tri={ultimoResultado.tri_cn}
                  color="bg-green-500"
                />
                <AreaTRICard
                  area="MT"
                  label="Matemática"
                  icon={Calculator}
                  tri={ultimoResultado.tri_mt}
                  color="bg-blue-500"
                />
              </div>
            </div>

            {/* Card de Acertos/Erros/Brancos */}
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Target className="h-5 w-5 text-green-600" />
                Resumo de Acertos
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Acertos */}
                <Card className="border-green-200">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-full bg-green-100">
                        <CheckCircle2 className="h-6 w-6 text-green-600" />
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-green-700">
                          {ultimoResultado.correct_answers ?? '---'}
                        </div>
                        <div className="text-sm text-gray-500">Acertos</div>
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

                {/* Erros */}
                <Card className="border-red-200">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-full bg-red-100">
                        <XCircle className="h-6 w-6 text-red-600" />
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-red-700">
                          {ultimoResultado.wrong_answers ?? '---'}
                        </div>
                        <div className="text-sm text-gray-500">Erros</div>
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

                {/* Em Branco */}
                <Card className="border-gray-200">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-full bg-gray-100">
                        <MinusCircle className="h-6 w-6 text-gray-600" />
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-gray-700">
                          {ultimoResultado.blank_answers ?? '---'}
                        </div>
                        <div className="text-sm text-gray-500">Em Branco</div>
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

            {/* GAB-108: Histórico de Provas */}
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <History className="h-5 w-5 text-purple-600" />
                Histórico de Provas
              </h2>
              <Card>
                <CardContent className="pt-6">
                  {results.length === 0 ? (
                    <div className="text-center py-8">
                      <Calendar className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                      <h3 className="text-lg font-semibold text-gray-700 mb-2">
                        Sem provas registradas
                      </h3>
                      <p className="text-gray-500">
                        Seu histórico de provas aparecerá aqui.
                      </p>
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
                                <span className="font-medium">
                                  {result.exams?.title || 'Prova'}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {result.exams?.template_type || 'N/A'}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="font-medium text-green-600">
                                {result.correct_answers ?? '-'}
                              </span>
                              <span className="text-gray-400">
                                /{result.answers?.length || '-'}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge className={`${classificarTRI(result.tri_score).color}`}>
                                {result.tri_score?.toFixed(0) || '---'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              <EvolutionIndicator
                                current={result.tri_score}
                                previous={getPreviousTRI(index)}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewDetails(result)}
                              >
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
            </div>

            {/* GAB-109: Gráfico de Evolução TRI */}
            {results.length >= 2 ? (
              <div>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                  Evolução do TRI
                </h2>
                <Card>
                  <CardContent className="pt-6">
                    <ResponsiveContainer width="100%" height={300}>
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
                            tri: result.tri_score,
                            prova: result.exams?.title || 'Prova',
                            acertos: result.correct_answers,
                            total: result.answers?.length || 0,
                          }))
                        }
                        margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey="date"
                          tick={{ fill: '#6b7280', fontSize: 12 }}
                          tickLine={{ stroke: '#d1d5db' }}
                        />
                        <YAxis
                          domain={[400, 800]}
                          tick={{ fill: '#6b7280', fontSize: 12 }}
                          tickLine={{ stroke: '#d1d5db' }}
                          tickFormatter={(value) => value.toFixed(0)}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
                                  <p className="font-semibold text-gray-900">{data.prova}</p>
                                  <p className="text-sm text-gray-500">{data.fullDate}</p>
                                  <div className="mt-2 space-y-1">
                                    <p className="text-blue-600 font-bold">
                                      TRI: {data.tri?.toFixed(1) || '---'}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                      Acertos: {data.acertos}/{data.total}
                                    </p>
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <ReferenceLine
                          y={550}
                          stroke="#f59e0b"
                          strokeDasharray="5 5"
                          label={{ value: 'Média ENEM', position: 'right', fill: '#f59e0b', fontSize: 11 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="tri"
                          stroke="#3b82f6"
                          strokeWidth={3}
                          dot={{ fill: '#3b82f6', strokeWidth: 2, r: 5 }}
                          activeDot={{ r: 8, fill: '#2563eb' }}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="flex justify-center gap-6 mt-4 text-sm text-gray-500">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                        <span>Sua nota TRI</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-0.5 bg-amber-500" style={{ borderTop: '2px dashed #f59e0b' }}></div>
                        <span>Média ENEM (~550)</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : results.length === 1 ? (
              <div>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                  Evolução do TRI
                </h2>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center py-8">
                      <TrendingUp className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                      <h3 className="text-lg font-semibold text-gray-700 mb-2">
                        Continue fazendo provas!
                      </h3>
                      <p className="text-gray-500">
                        O gráfico de evolução aparecerá quando você tiver 2 ou mais provas realizadas.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}

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
                      <div className="text-2xl font-bold text-green-600">
                        {mediaTriGeral.toFixed(1)}
                      </div>
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
              <DialogTitle>
                {selectedResult?.exams?.title || 'Detalhes da Prova'}
              </DialogTitle>
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
                {/* TRI Geral */}
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <div className="text-sm text-gray-500">TRI Geral</div>
                    <div className="text-3xl font-bold">
                      {selectedResult.tri_score?.toFixed(1) || '---'}
                    </div>
                  </div>
                  <Badge className={`${classificarTRI(selectedResult.tri_score).color} text-sm`}>
                    {classificarTRI(selectedResult.tri_score).emoji} {classificarTRI(selectedResult.tri_score).label}
                  </Badge>
                </div>

                {/* TRI por Área */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 border rounded-lg">
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                      <BookOpen className="h-4 w-4" />
                      Linguagens
                    </div>
                    <div className="text-xl font-bold">
                      {selectedResult.tri_lc?.toFixed(1) || '---'}
                    </div>
                  </div>
                  <div className="p-3 border rounded-lg">
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                      <Brain className="h-4 w-4" />
                      Humanas
                    </div>
                    <div className="text-xl font-bold">
                      {selectedResult.tri_ch?.toFixed(1) || '---'}
                    </div>
                  </div>
                  <div className="p-3 border rounded-lg">
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                      <Leaf className="h-4 w-4" />
                      Natureza
                    </div>
                    <div className="text-xl font-bold">
                      {selectedResult.tri_cn?.toFixed(1) || '---'}
                    </div>
                  </div>
                  <div className="p-3 border rounded-lg">
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                      <Calculator className="h-4 w-4" />
                      Matemática
                    </div>
                    <div className="text-xl font-bold">
                      {selectedResult.tri_mt?.toFixed(1) || '---'}
                    </div>
                  </div>
                </div>

                {/* Resumo de Acertos */}
                <div className="flex justify-around p-4 bg-gray-50 rounded-lg">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {selectedResult.correct_answers ?? '-'}
                    </div>
                    <div className="text-xs text-gray-500">Acertos</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-600">
                      {selectedResult.wrong_answers ?? '-'}
                    </div>
                    <div className="text-xs text-gray-500">Erros</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-600">
                      {selectedResult.blank_answers ?? '-'}
                    </div>
                    <div className="text-xs text-gray-500">Em Branco</div>
                  </div>
                </div>

                {/* Informações Adicionais */}
                <div className="text-sm text-gray-500 space-y-1">
                  <div>Total de questões: {selectedResult.answers?.length || '-'}</div>
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
