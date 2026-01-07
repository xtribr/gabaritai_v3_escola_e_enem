import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LogOut, Users, GraduationCap, Settings, ArrowLeft, Download, Loader2, CheckCircle2, XCircle, AlertCircle, Search, RefreshCw, Trash2, KeyRound, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'wouter';
import { CsvUploader, StudentRow } from '@/components/CsvUploader';

interface ImportResult {
  matricula: string;
  nome: string;
  turma: string;
  email: string;
  senha: string;
  status: 'created' | 'updated' | 'error';
  message?: string;
}

interface ImportResponse {
  success: boolean;
  summary: {
    total: number;
    created: number;
    updated: number;
    errors: number;
  };
  results: ImportResult[];
}

interface Student {
  id: string;
  name: string;
  email: string;
  student_number: string | null;
  turma: string | null;
  created_at: string;
}

interface StudentsResponse {
  success: boolean;
  students: Student[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  turmas: string[];
}

export default function AdminPage() {
  const { profile, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState('alunos');

  // CSV Upload states
  const [pendingStudents, setPendingStudents] = useState<StudentRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<ImportResponse | null>(null);
  const [showResultsModal, setShowResultsModal] = useState(false);

  // Students List states
  const [students, setStudents] = useState<Student[]>([]);
  const [turmas, setTurmas] = useState<string[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTurma, setSelectedTurma] = useState<string>('all');
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, totalPages: 0 });

  // Action states
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);
  const [studentToResetPassword, setStudentToResetPassword] = useState<Student | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const handleLogout = async () => {
    await signOut();
  };

  // Fetch students
  const fetchStudents = useCallback(async (page = 1) => {
    setIsLoadingStudents(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pagination.limit.toString(),
      });

      if (selectedTurma && selectedTurma !== 'all') {
        params.append('turma', selectedTurma);
      }

      if (searchTerm) {
        params.append('search', searchTerm);
      }

      const response = await fetch(`/api/admin/students?${params}`);
      const data: StudentsResponse = await response.json();

      if (data.success) {
        setStudents(data.students);
        setPagination(data.pagination);
        setTurmas(data.turmas);
      }
    } catch (error) {
      console.error('Erro ao buscar alunos:', error);
    } finally {
      setIsLoadingStudents(false);
    }
  }, [selectedTurma, searchTerm, pagination.limit]);

  // Load students on mount and when filters change
  useEffect(() => {
    fetchStudents(1);
  }, [selectedTurma]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchStudents(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Refresh after import
  useEffect(() => {
    if (showResultsModal === false && importResults?.success) {
      fetchStudents(1);
    }
  }, [showResultsModal]);

  const handleCsvDataReady = (data: StudentRow[]) => {
    setPendingStudents(data);
  };

  const handleImport = async () => {
    if (pendingStudents.length === 0) return;

    setIsImporting(true);
    setImportProgress(10);

    try {
      const progressInterval = setInterval(() => {
        setImportProgress(prev => Math.min(prev + 10, 90));
      }, 200);

      const response = await fetch('/api/admin/import-students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          students: pendingStudents,
          schoolId: profile?.school_id || null,
        }),
      });

      clearInterval(progressInterval);
      setImportProgress(100);

      if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);

      const data: ImportResponse = await response.json();
      setImportResults(data);
      setShowResultsModal(true);

      if (data.success) {
        setPendingStudents([]);
      }
    } catch (error) {
      console.error('Erro ao importar:', error);
      setImportResults({
        success: false,
        summary: { total: pendingStudents.length, created: 0, updated: 0, errors: pendingStudents.length },
        results: [{
          matricula: 'N/A', nome: 'Erro', turma: 'N/A', email: 'N/A', senha: '',
          status: 'error',
          message: error instanceof Error ? error.message : 'Erro desconhecido'
        }]
      });
      setShowResultsModal(true);
    } finally {
      setIsImporting(false);
      setImportProgress(0);
    }
  };

  const handleResetPassword = async () => {
    if (!studentToResetPassword) return;

    setIsActionLoading(true);
    try {
      const response = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: studentToResetPassword.id,
          matricula: studentToResetPassword.student_number,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setNewPassword(data.novaSenha);
      } else {
        alert(`Erro: ${data.error}`);
        setStudentToResetPassword(null);
      }
    } catch (error) {
      console.error('Erro ao resetar senha:', error);
      alert('Erro ao resetar senha');
      setStudentToResetPassword(null);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDeleteStudent = async () => {
    if (!studentToDelete) return;

    setIsActionLoading(true);
    try {
      const response = await fetch(`/api/admin/students/${studentToDelete.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.success) {
        fetchStudents(pagination.page);
      } else {
        alert(`Erro: ${data.error}`);
      }
    } catch (error) {
      console.error('Erro ao remover aluno:', error);
      alert('Erro ao remover aluno');
    } finally {
      setIsActionLoading(false);
      setStudentToDelete(null);
    }
  };

  const downloadCredentialsCsv = () => {
    if (!importResults) return;

    const createdStudents = importResults.results.filter(
      r => r.status === 'created' && r.senha && !r.senha.startsWith('(')
    );

    if (createdStudents.length === 0) {
      alert('Nenhum aluno novo foi criado com credenciais para baixar.');
      return;
    }

    const headers = ['Matrícula', 'Nome', 'Turma', 'Email', 'Senha'];
    const rows = createdStudents.map(s => [s.matricula, s.nome, s.turma, s.email, s.senha]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `credenciais_alunos_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: ImportResult['status']) => {
    switch (status) {
      case 'created':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Criado</Badge>;
      case 'updated':
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Atualizado</Badge>;
      case 'error':
        return <Badge variant="destructive">Erro</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                  Escola Demo XTRI
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Painel Administrativo
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {profile?.name}
              </span>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                Sair
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="alunos" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Alunos
            </TabsTrigger>
            <TabsTrigger value="turmas" className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4" />
              Turmas
            </TabsTrigger>
            <TabsTrigger value="configuracoes" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Configurações
            </TabsTrigger>
          </TabsList>

          <TabsContent value="alunos" className="space-y-6">
            {/* Upload CSV Card */}
            <Card>
              <CardHeader>
                <CardTitle>Importar Alunos</CardTitle>
                <CardDescription>
                  Importe alunos via arquivo CSV
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <CsvUploader
                  onDataReady={handleCsvDataReady}
                  onCancel={() => setPendingStudents([])}
                />

                {pendingStudents.length > 0 && (
                  <div className="space-y-4 pt-4 border-t">
                    {isImporting ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <Loader2 className="h-5 w-5 animate-spin text-primary" />
                          <span className="text-sm font-medium">
                            Importando {pendingStudents.length} aluno(s)...
                          </span>
                        </div>
                        <Progress value={importProgress} className="h-2" />
                      </div>
                    ) : (
                      <Button onClick={handleImport} className="w-full sm:w-auto" size="lg">
                        <Users className="h-4 w-4 mr-2" />
                        Importar {pendingStudents.length} Aluno(s)
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Students List Card */}
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <CardTitle>Alunos Cadastrados</CardTitle>
                    <CardDescription>
                      {pagination.total} aluno(s) encontrado(s)
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => fetchStudents(pagination.page)}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Atualizar
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Buscar por nome ou matrícula..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <Select value={selectedTurma} onValueChange={setSelectedTurma}>
                    <SelectTrigger className="w-full sm:w-40">
                      <SelectValue placeholder="Todas turmas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas turmas</SelectItem>
                      {turmas.map((turma) => (
                        <SelectItem key={turma} value={turma}>
                          {turma}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Table */}
                {isLoadingStudents ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                  </div>
                ) : students.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhum aluno encontrado</p>
                    {(searchTerm || selectedTurma !== 'all') && (
                      <p className="text-sm mt-2">Tente ajustar os filtros</p>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Matrícula</TableHead>
                            <TableHead>Nome</TableHead>
                            <TableHead>Turma</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead className="text-right">Ações</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {students.map((student) => (
                            <TableRow key={student.id}>
                              <TableCell className="font-mono">
                                {student.student_number || '-'}
                              </TableCell>
                              <TableCell>{student.name}</TableCell>
                              <TableCell>
                                <Badge variant="outline">{student.turma || '-'}</Badge>
                              </TableCell>
                              <TableCell className="text-sm text-gray-500">
                                {student.email}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setStudentToResetPassword(student)}
                                    title="Resetar senha"
                                  >
                                    <KeyRound className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setStudentToDelete(student)}
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                    title="Remover aluno"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Pagination */}
                    {pagination.totalPages > 1 && (
                      <div className="flex items-center justify-between pt-4">
                        <p className="text-sm text-gray-500">
                          Página {pagination.page} de {pagination.totalPages}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pagination.page === 1}
                            onClick={() => fetchStudents(pagination.page - 1)}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pagination.page === pagination.totalPages}
                            onClick={() => fetchStudents(pagination.page + 1)}
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

          <TabsContent value="turmas">
            <Card>
              <CardHeader>
                <CardTitle>Gestão de Turmas</CardTitle>
                <CardDescription>
                  Organize os alunos por turmas
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-12 text-gray-500">
                  <GraduationCap className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Lista de turmas será adicionada aqui</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="configuracoes">
            <Card>
              <CardHeader>
                <CardTitle>Configurações da Escola</CardTitle>
                <CardDescription>
                  Ajuste as configurações gerais
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-12 text-gray-500">
                  <Settings className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Configurações serão adicionadas aqui</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Modal de Resultados da Importação */}
      <Dialog open={showResultsModal} onOpenChange={setShowResultsModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {importResults?.success ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-yellow-600" />
              )}
              Resultado da Importação
            </DialogTitle>
            <DialogDescription>
              {importResults && (
                <div className="flex gap-4 mt-2">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    {importResults.summary.created} criado(s)
                  </span>
                  <span className="flex items-center gap-1">
                    <AlertCircle className="h-4 w-4 text-blue-600" />
                    {importResults.summary.updated} atualizado(s)
                  </span>
                  <span className="flex items-center gap-1">
                    <XCircle className="h-4 w-4 text-red-600" />
                    {importResults.summary.errors} erro(s)
                  </span>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto border rounded-lg mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Matrícula</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Turma</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Senha</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importResults?.results.map((result, idx) => (
                  <TableRow key={idx} className={result.status === 'error' ? 'bg-red-50 dark:bg-red-950' : ''}>
                    <TableCell className="font-mono">{result.matricula}</TableCell>
                    <TableCell>{result.nome}</TableCell>
                    <TableCell>{result.turma}</TableCell>
                    <TableCell className="text-sm">{result.email}</TableCell>
                    <TableCell className="font-mono text-sm">{result.senha || '-'}</TableCell>
                    <TableCell>
                      {getStatusBadge(result.status)}
                      {result.status === 'error' && result.message && (
                        <p className="text-xs text-red-600 mt-1">{result.message}</p>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-between items-center mt-4 pt-4 border-t">
            <p className="text-sm text-gray-500">
              As senhas são exibidas apenas uma vez. Baixe o arquivo para guardar.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setShowResultsModal(false)}>
                Fechar
              </Button>
              <Button onClick={downloadCredentialsCsv} className="gap-2">
                <Download className="h-4 w-4" />
                Baixar Credenciais (CSV)
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Resetar Senha */}
      <Dialog
        open={!!studentToResetPassword}
        onOpenChange={(open) => {
          if (!open) {
            setStudentToResetPassword(null);
            setNewPassword(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Resetar Senha
            </DialogTitle>
            <DialogDescription>
              {newPassword ? (
                'Nova senha gerada com sucesso!'
              ) : (
                `Gerar nova senha para ${studentToResetPassword?.name}?`
              )}
            </DialogDescription>
          </DialogHeader>

          {newPassword ? (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Nova senha:</p>
                <p className="text-2xl font-mono font-bold text-green-700 dark:text-green-300">
                  {newPassword}
                </p>
              </div>
              <p className="text-sm text-gray-500">
                Anote esta senha. Ela não será exibida novamente.
              </p>
              <Button
                className="w-full"
                onClick={() => {
                  setStudentToResetPassword(null);
                  setNewPassword(null);
                }}
              >
                Fechar
              </Button>
            </div>
          ) : (
            <div className="flex justify-end gap-3 mt-4">
              <Button variant="outline" onClick={() => setStudentToResetPassword(null)}>
                Cancelar
              </Button>
              <Button onClick={handleResetPassword} disabled={isActionLoading}>
                {isActionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Gerar Nova Senha
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* AlertDialog Confirmar Exclusão */}
      <AlertDialog open={!!studentToDelete} onOpenChange={(open) => !open && setStudentToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Aluno</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover <strong>{studentToDelete?.name}</strong>?
              <br />
              Esta ação não pode ser desfeita. O aluno perderá acesso ao sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteStudent}
              className="bg-red-600 hover:bg-red-700"
              disabled={isActionLoading}
            >
              {isActionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
