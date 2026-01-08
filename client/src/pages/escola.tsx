import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Loader2, LogOut, Users, FileText, BarChart2, School } from 'lucide-react';

interface StudentResult {
  id: string;
  student_name: string;
  student_number: string | null;
  turma: string | null;
  score: number | null;
  correct_answers: number | null;
  wrong_answers: number | null;
  blank_answers: number | null;
  tri_lc: number | null;
  tri_ch: number | null;
  tri_cn: number | null;
  tri_mt: number | null;
  exam_title: string;
  created_at: string;
}

interface SchoolStats {
  totalStudents: number;
  totalExams: number;
  averageScore: number;
  turmas: string[];
}

export default function EscolaPage() {
  const { profile, signOut } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<StudentResult[]>([]);
  const [stats, setStats] = useState<SchoolStats | null>(null);
  const [selectedTurma, setSelectedTurma] = useState<string>('all');

  useEffect(() => {
    fetchSchoolData();
  }, []);

  async function fetchSchoolData() {
    try {
      setLoading(true);

      // Buscar resultados da escola
      const response = await fetch('/api/escola/results', {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Erro ao buscar dados da escola');
      }

      const data = await response.json();
      setResults(data.results || []);
      setStats(data.stats || null);
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message || 'Falha ao carregar dados',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  // Filtrar resultados por turma
  const filteredResults = selectedTurma === 'all'
    ? results
    : results.filter(r => r.turma === selectedTurma);

  // Agrupar por turma para estatísticas
  const turmaStats = results.reduce((acc, result) => {
    const turma = result.turma || 'Sem turma';
    if (!acc[turma]) {
      acc[turma] = { count: 0, totalCorrect: 0 };
    }
    acc[turma].count++;
    acc[turma].totalCorrect += result.correct_answers || 0;
    return acc;
  }, {} as Record<string, { count: number; totalCorrect: number }>);

  if (loading) {
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
        {/* Cards de Estatísticas */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total de Alunos</CardDescription>
              <CardTitle className="text-3xl">
                <Users className="h-5 w-5 inline mr-2 text-blue-600" />
                {stats?.totalStudents || 0}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Provas Realizadas</CardDescription>
              <CardTitle className="text-3xl">
                <FileText className="h-5 w-5 inline mr-2 text-green-600" />
                {stats?.totalExams || 0}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Nota Média</CardDescription>
              <CardTitle className="text-3xl">
                <BarChart2 className="h-5 w-5 inline mr-2 text-purple-600" />
                {stats?.averageScore?.toFixed(1) || '-'}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Turmas</CardDescription>
              <CardTitle className="text-3xl">
                {stats?.turmas?.length || 0}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Tabs de Conteúdo */}
        <Tabs defaultValue="resultados" className="space-y-4">
          <TabsList>
            <TabsTrigger value="resultados">Resultados</TabsTrigger>
            <TabsTrigger value="turmas">Por Turma</TabsTrigger>
          </TabsList>

          <TabsContent value="resultados">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Resultados dos Alunos</CardTitle>
                  <select
                    value={selectedTurma}
                    onChange={(e) => setSelectedTurma(e.target.value)}
                    className="border rounded px-3 py-1 text-sm"
                  >
                    <option value="all">Todas as turmas</option>
                    {stats?.turmas?.map((turma) => (
                      <option key={turma} value={turma}>{turma}</option>
                    ))}
                  </select>
                </div>
              </CardHeader>
              <CardContent>
                {filteredResults.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">
                    Nenhum resultado encontrado
                  </p>
                ) : (
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
                        {filteredResults.map((result) => (
                          <TableRow key={result.id}>
                            <TableCell className="font-medium">
                              {result.student_name}
                            </TableCell>
                            <TableCell>{result.student_number || '-'}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{result.turma || '-'}</Badge>
                            </TableCell>
                            <TableCell>{result.exam_title}</TableCell>
                            <TableCell className="text-center">
                              {result.correct_answers ?? '-'}
                            </TableCell>
                            <TableCell className="text-center">
                              {result.tri_lc?.toFixed(1) || '-'}
                            </TableCell>
                            <TableCell className="text-center">
                              {result.tri_ch?.toFixed(1) || '-'}
                            </TableCell>
                            <TableCell className="text-center">
                              {result.tri_cn?.toFixed(1) || '-'}
                            </TableCell>
                            <TableCell className="text-center">
                              {result.tri_mt?.toFixed(1) || '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="turmas">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(turmaStats).map(([turma, data]) => (
                <Card key={turma}>
                  <CardHeader>
                    <CardTitle className="text-lg">{turma}</CardTitle>
                    <CardDescription>
                      {data.count} aluno{data.count !== 1 ? 's' : ''}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      Média: {(data.totalCorrect / data.count).toFixed(1)} acertos
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
