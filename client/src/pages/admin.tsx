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
import { LogOut, Users, GraduationCap, Settings, ArrowLeft, Download, Loader2, CheckCircle2, XCircle, AlertCircle, Search, RefreshCw, Trash2, KeyRound, ChevronLeft, ChevronRight, Printer, FileText, Building2, ClipboardList, Plus, Edit2, Power, MapPin, Phone, Mail, Calendar } from 'lucide-react';
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

interface Turma {
  nome: string;
  alunosCount: number;
}

interface TurmaAluno {
  id: string;
  name: string;
  student_number: string | null;
  turma: string | null;
  email: string;
}

interface School {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
  students_count?: number;
  simulados_count?: number;
}

interface Simulado {
  id: string;
  name: string;
  description: string | null;
  school_id: string;
  school_name?: string;
  status: 'draft' | 'active' | 'closed';
  questions_count: number;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  answers_count?: number;
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

  // Turmas states
  const [turmasList, setTurmasList] = useState<Turma[]>([]);
  const [isLoadingTurmas, setIsLoadingTurmas] = useState(false);
  const [selectedTurmaForPrint, setSelectedTurmaForPrint] = useState<string | null>(null);
  const [turmaAlunos, setTurmaAlunos] = useState<TurmaAluno[]>([]);
  const [isLoadingTurmaAlunos, setIsLoadingTurmaAlunos] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // Schools states (SUPER_ADMIN only)
  const [schools, setSchools] = useState<School[]>([]);
  const [isLoadingSchools, setIsLoadingSchools] = useState(false);
  const [schoolToEdit, setSchoolToEdit] = useState<School | null>(null);
  const [showSchoolModal, setShowSchoolModal] = useState(false);
  const [schoolForm, setSchoolForm] = useState({ name: '', slug: '', address: '', phone: '', email: '' });

  // Simulados states (SUPER_ADMIN only)
  const [simulados, setSimulados] = useState<Simulado[]>([]);
  const [isLoadingSimulados, setIsLoadingSimulados] = useState(false);
  const [simuladoToEdit, setSimuladoToEdit] = useState<Simulado | null>(null);
  const [showSimuladoModal, setShowSimuladoModal] = useState(false);
  const [simuladoForm, setSimuladoForm] = useState({ name: '', description: '', school_id: '', questions_count: 90, start_date: '', end_date: '' });
  const [selectedSchoolFilter, setSelectedSchoolFilter] = useState<string>('all');

  const isSuperAdmin = profile?.role === 'super_admin';

  const handleLogout = async () => {
    await signOut();
  };

  // Fetch turmas
  const fetchTurmas = useCallback(async () => {
    setIsLoadingTurmas(true);
    try {
      const response = await fetch('/api/admin/turmas');
      const data = await response.json();
      if (data.success) {
        setTurmasList(data.turmas);
      }
    } catch (error) {
      console.error('Erro ao buscar turmas:', error);
    } finally {
      setIsLoadingTurmas(false);
    }
  }, []);

  // Fetch alunos de uma turma
  const fetchTurmaAlunos = useCallback(async (turmaNome: string) => {
    setIsLoadingTurmaAlunos(true);
    try {
      const response = await fetch(`/api/admin/turmas/${encodeURIComponent(turmaNome)}/alunos`);
      const data = await response.json();
      if (data.success) {
        setTurmaAlunos(data.alunos);
      }
    } catch (error) {
      console.error('Erro ao buscar alunos da turma:', error);
    } finally {
      setIsLoadingTurmaAlunos(false);
    }
  }, []);

  // Gerar PDFs de gabaritos
  const handleGenerateGabaritos = async (turmaNome: string) => {
    setIsGeneratingPdf(true);
    try {
      const response = await fetch('/api/admin/generate-gabaritos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turma: turmaNome }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao gerar gabaritos');
      }

      // Baixar o PDF
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `gabaritos_${turmaNome.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erro ao gerar gabaritos:', error);
      alert(error instanceof Error ? error.message : 'Erro ao gerar gabaritos');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // Fetch schools (SUPER_ADMIN)
  const fetchSchools = useCallback(async () => {
    if (!isSuperAdmin) return;
    setIsLoadingSchools(true);
    try {
      const response = await fetch('/api/schools');
      const data = await response.json();
      if (data.success) {
        setSchools(data.schools);
      }
    } catch (error) {
      console.error('Erro ao buscar escolas:', error);
    } finally {
      setIsLoadingSchools(false);
    }
  }, [isSuperAdmin]);

  // Fetch simulados (SUPER_ADMIN)
  const fetchSimulados = useCallback(async () => {
    if (!isSuperAdmin) return;
    setIsLoadingSimulados(true);
    try {
      const params = new URLSearchParams();
      if (selectedSchoolFilter && selectedSchoolFilter !== 'all') {
        params.append('school_id', selectedSchoolFilter);
      }
      const response = await fetch(`/api/simulados?${params}`);
      const data = await response.json();
      if (data.success) {
        setSimulados(data.simulados);
      }
    } catch (error) {
      console.error('Erro ao buscar simulados:', error);
    } finally {
      setIsLoadingSimulados(false);
    }
  }, [isSuperAdmin, selectedSchoolFilter]);

  // School CRUD handlers
  const handleSaveSchool = async () => {
    setIsActionLoading(true);
    try {
      const method = schoolToEdit ? 'PUT' : 'POST';
      const url = schoolToEdit ? `/api/schools/${schoolToEdit.id}` : '/api/schools';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(schoolForm),
      });

      const data = await response.json();
      if (data.success) {
        fetchSchools();
        setShowSchoolModal(false);
        setSchoolToEdit(null);
        setSchoolForm({ name: '', slug: '', address: '', phone: '', email: '' });
      } else {
        alert(`Erro: ${data.error}`);
      }
    } catch (error) {
      console.error('Erro ao salvar escola:', error);
      alert('Erro ao salvar escola');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleToggleSchoolStatus = async (school: School) => {
    try {
      const response = await fetch(`/api/schools/${school.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !school.is_active }),
      });

      const data = await response.json();
      if (data.success) {
        fetchSchools();
      } else {
        alert(`Erro: ${data.error}`);
      }
    } catch (error) {
      console.error('Erro ao atualizar status:', error);
    }
  };

  // Simulado CRUD handlers
  const handleSaveSimulado = async () => {
    setIsActionLoading(true);
    try {
      const method = simuladoToEdit ? 'PUT' : 'POST';
      const url = simuladoToEdit ? `/api/simulados/${simuladoToEdit.id}` : '/api/simulados';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...simuladoForm,
          questions_count: parseInt(String(simuladoForm.questions_count)) || 90,
        }),
      });

      const data = await response.json();
      if (data.success) {
        fetchSimulados();
        setShowSimuladoModal(false);
        setSimuladoToEdit(null);
        setSimuladoForm({ name: '', description: '', school_id: '', questions_count: 90, start_date: '', end_date: '' });
      } else {
        alert(`Erro: ${data.error}`);
      }
    } catch (error) {
      console.error('Erro ao salvar simulado:', error);
      alert('Erro ao salvar simulado');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleChangeSimuladoStatus = async (simulado: Simulado, newStatus: 'draft' | 'active' | 'closed') => {
    try {
      const response = await fetch(`/api/simulados/${simulado.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await response.json();
      if (data.success) {
        fetchSimulados();
      } else {
        alert(`Erro: ${data.error}`);
      }
    } catch (error) {
      console.error('Erro ao atualizar status:', error);
    }
  };

  const openEditSchool = (school: School) => {
    setSchoolToEdit(school);
    setSchoolForm({
      name: school.name,
      slug: school.slug,
      address: school.address || '',
      phone: school.phone || '',
      email: school.email || '',
    });
    setShowSchoolModal(true);
  };

  const openEditSimulado = (simulado: Simulado) => {
    setSimuladoToEdit(simulado);
    setSimuladoForm({
      name: simulado.name,
      description: simulado.description || '',
      school_id: simulado.school_id,
      questions_count: simulado.questions_count,
      start_date: simulado.start_date || '',
      end_date: simulado.end_date || '',
    });
    setShowSimuladoModal(true);
  };

  // Load turmas when tab changes
  useEffect(() => {
    if (activeTab === 'turmas') {
      fetchTurmas();
    }
    if (activeTab === 'escolas' && isSuperAdmin) {
      fetchSchools();
    }
    if (activeTab === 'simulados' && isSuperAdmin) {
      fetchSchools(); // Need schools for filter
      fetchSimulados();
    }
  }, [activeTab, fetchTurmas, fetchSchools, fetchSimulados, isSuperAdmin]);

  // Load turma alunos when selected
  useEffect(() => {
    if (selectedTurmaForPrint) {
      fetchTurmaAlunos(selectedTurmaForPrint);
    } else {
      setTurmaAlunos([]);
    }
  }, [selectedTurmaForPrint, fetchTurmaAlunos]);

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

  // Refresh simulados when school filter changes
  useEffect(() => {
    if (activeTab === 'simulados' && isSuperAdmin) {
      fetchSimulados();
    }
  }, [selectedSchoolFilter]);

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
          <TabsList className={`grid w-full ${isSuperAdmin ? 'grid-cols-5 max-w-2xl' : 'grid-cols-3 max-w-md'}`}>
            <TabsTrigger value="alunos" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Alunos
            </TabsTrigger>
            <TabsTrigger value="turmas" className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4" />
              Turmas
            </TabsTrigger>
            {isSuperAdmin && (
              <>
                <TabsTrigger value="escolas" className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Escolas
                </TabsTrigger>
                <TabsTrigger value="simulados" className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4" />
                  Simulados
                </TabsTrigger>
              </>
            )}
            <TabsTrigger value="configuracoes" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Config
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

          <TabsContent value="turmas" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <CardTitle>Gestão de Turmas</CardTitle>
                    <CardDescription>
                      Imprima gabaritos personalizados para cada turma
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={fetchTurmas}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Atualizar
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingTurmas ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                  </div>
                ) : turmasList.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <GraduationCap className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhuma turma encontrada</p>
                    <p className="text-sm mt-2">Importe alunos com turma definida na aba "Alunos"</p>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {turmasList.map((turma) => (
                      <Card key={turma.nome} className="relative overflow-hidden">
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">{turma.nome}</CardTitle>
                            <Badge variant="secondary">
                              {turma.alunosCount} aluno{turma.alunosCount !== 1 ? 's' : ''}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-2">
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => setSelectedTurmaForPrint(
                                selectedTurmaForPrint === turma.nome ? null : turma.nome
                              )}
                            >
                              <Users className="h-4 w-4 mr-2" />
                              Ver Alunos
                            </Button>
                            <Button
                              size="sm"
                              className="flex-1"
                              onClick={() => handleGenerateGabaritos(turma.nome)}
                              disabled={isGeneratingPdf}
                            >
                              {isGeneratingPdf ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Printer className="h-4 w-4 mr-2" />
                              )}
                              Imprimir Gabaritos
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Lista de alunos da turma selecionada */}
            {selectedTurmaForPrint && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">Alunos - {selectedTurmaForPrint}</CardTitle>
                      <CardDescription>
                        {turmaAlunos.length} aluno(s) nesta turma
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedTurmaForPrint(null)}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {isLoadingTurmaAlunos ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                    </div>
                  ) : (
                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Matrícula</TableHead>
                            <TableHead>Nome</TableHead>
                            <TableHead>Email</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {turmaAlunos.map((aluno) => (
                            <TableRow key={aluno.id}>
                              <TableCell className="font-mono">
                                {aluno.student_number || '-'}
                              </TableCell>
                              <TableCell>{aluno.name}</TableCell>
                              <TableCell className="text-sm text-gray-500">
                                {aluno.email}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ESCOLAS TAB (SUPER_ADMIN) */}
          {isSuperAdmin && (
            <TabsContent value="escolas" className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <CardTitle>Gestão de Escolas</CardTitle>
                      <CardDescription>
                        {schools.length} escola(s) cadastrada(s)
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={fetchSchools}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Atualizar
                      </Button>
                      <Button size="sm" onClick={() => {
                        setSchoolToEdit(null);
                        setSchoolForm({ name: '', slug: '', address: '', phone: '', email: '' });
                        setShowSchoolModal(true);
                      }}>
                        <Plus className="h-4 w-4 mr-2" />
                        Nova Escola
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {isLoadingSchools ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    </div>
                  ) : schools.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Nenhuma escola cadastrada</p>
                      <p className="text-sm mt-2">Clique em "Nova Escola" para adicionar</p>
                    </div>
                  ) : (
                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>Slug</TableHead>
                            <TableHead>Contato</TableHead>
                            <TableHead>Alunos</TableHead>
                            <TableHead>Simulados</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Ações</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {schools.map((school) => (
                            <TableRow key={school.id}>
                              <TableCell className="font-medium">{school.name}</TableCell>
                              <TableCell className="font-mono text-sm">{school.slug}</TableCell>
                              <TableCell className="text-sm">
                                {school.email || school.phone || '-'}
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary">
                                  {school.students_count || 0}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary">
                                  {school.simulados_count || 0}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant={school.is_active ? 'default' : 'destructive'}>
                                  {school.is_active ? 'Ativa' : 'Inativa'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openEditSchool(school)}
                                    title="Editar"
                                  >
                                    <Edit2 className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleToggleSchoolStatus(school)}
                                    title={school.is_active ? 'Desativar' : 'Ativar'}
                                    className={school.is_active ? 'text-orange-600' : 'text-green-600'}
                                  >
                                    <Power className="h-4 w-4" />
                                  </Button>
                                </div>
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
          )}

          {/* SIMULADOS TAB (SUPER_ADMIN) */}
          {isSuperAdmin && (
            <TabsContent value="simulados" className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <CardTitle>Gestão de Simulados</CardTitle>
                      <CardDescription>
                        {simulados.length} simulado(s) encontrado(s)
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={fetchSimulados}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Atualizar
                      </Button>
                      <Button size="sm" onClick={() => {
                        setSimuladoToEdit(null);
                        setSimuladoForm({ name: '', description: '', school_id: '', questions_count: 90, start_date: '', end_date: '' });
                        setShowSimuladoModal(true);
                      }} disabled={schools.length === 0}>
                        <Plus className="h-4 w-4 mr-2" />
                        Novo Simulado
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Filter by school */}
                  <div className="flex gap-4">
                    <Select value={selectedSchoolFilter} onValueChange={setSelectedSchoolFilter}>
                      <SelectTrigger className="w-full sm:w-64">
                        <SelectValue placeholder="Filtrar por escola" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas as escolas</SelectItem>
                        {schools.map((school) => (
                          <SelectItem key={school.id} value={school.id}>
                            {school.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {isLoadingSimulados ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    </div>
                  ) : schools.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Nenhuma escola cadastrada</p>
                      <p className="text-sm mt-2">Cadastre uma escola primeiro na aba "Escolas"</p>
                    </div>
                  ) : simulados.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <ClipboardList className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Nenhum simulado encontrado</p>
                      <p className="text-sm mt-2">Clique em "Novo Simulado" para criar</p>
                    </div>
                  ) : (
                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>Escola</TableHead>
                            <TableHead>Questões</TableHead>
                            <TableHead>Período</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Ações</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {simulados.map((simulado) => (
                            <TableRow key={simulado.id}>
                              <TableCell>
                                <div>
                                  <p className="font-medium">{simulado.name}</p>
                                  {simulado.description && (
                                    <p className="text-xs text-gray-500 truncate max-w-48">{simulado.description}</p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm">{simulado.school_name || '-'}</TableCell>
                              <TableCell>
                                <Badge variant="outline">{simulado.questions_count}</Badge>
                              </TableCell>
                              <TableCell className="text-sm">
                                {simulado.start_date ? (
                                  <span className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    {new Date(simulado.start_date).toLocaleDateString('pt-BR')}
                                    {simulado.end_date && ` - ${new Date(simulado.end_date).toLocaleDateString('pt-BR')}`}
                                  </span>
                                ) : (
                                  '-'
                                )}
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={simulado.status}
                                  onValueChange={(value: 'draft' | 'active' | 'closed') =>
                                    handleChangeSimuladoStatus(simulado, value)
                                  }
                                >
                                  <SelectTrigger className="w-24 h-8">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="draft">
                                      <Badge variant="secondary">Rascunho</Badge>
                                    </SelectItem>
                                    <SelectItem value="active">
                                      <Badge className="bg-green-100 text-green-800">Ativo</Badge>
                                    </SelectItem>
                                    <SelectItem value="closed">
                                      <Badge variant="destructive">Encerrado</Badge>
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEditSimulado(simulado)}
                                  title="Editar"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
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
          )}

          <TabsContent value="configuracoes" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Configurações da Escola
                </CardTitle>
                <CardDescription>
                  Informações e configurações gerais da escola
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Informações da Escola */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Nome da Escola</label>
                    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                      <p className="font-medium">Escola Demo XTRI</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Identificador</label>
                    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                      <p className="font-mono text-sm">demo</p>
                    </div>
                  </div>
                </div>

                {/* Estatísticas */}
                <div className="border-t pt-6">
                  <h3 className="text-sm font-medium mb-4">Estatísticas</h3>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                      <div className="flex items-center gap-3">
                        <Users className="h-8 w-8 text-blue-600" />
                        <div>
                          <p className="text-2xl font-bold">{pagination.total}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Total de Alunos</p>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                      <div className="flex items-center gap-3">
                        <GraduationCap className="h-8 w-8 text-green-600" />
                        <div>
                          <p className="text-2xl font-bold">{turmasList.length || turmas.length}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Turmas</p>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 bg-purple-50 dark:bg-purple-950 rounded-lg">
                      <div className="flex items-center gap-3">
                        <FileText className="h-8 w-8 text-purple-600" />
                        <div>
                          <p className="text-2xl font-bold">90</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Questões/Gabarito</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Instruções */}
                <div className="border-t pt-6">
                  <h3 className="text-sm font-medium mb-4">Como usar o sistema</h3>
                  <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                    <div className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">1</span>
                      <p><strong>Importar alunos:</strong> Na aba "Alunos", faça upload de um CSV com nome, turma e matrícula</p>
                    </div>
                    <div className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">2</span>
                      <p><strong>Imprimir gabaritos:</strong> Na aba "Turmas", clique em "Imprimir Gabaritos" para gerar PDFs personalizados</p>
                    </div>
                    <div className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">3</span>
                      <p><strong>Processar respostas:</strong> Volte ao GabaritAI e faça upload dos gabaritos preenchidos para correção automática</p>
                    </div>
                  </div>
                </div>

                {/* Formato CSV */}
                <div className="border-t pt-6">
                  <h3 className="text-sm font-medium mb-4">Formato do CSV para importação</h3>
                  <div className="bg-gray-900 text-gray-100 p-4 rounded-lg font-mono text-sm overflow-x-auto">
                    <p className="text-green-400"># Exemplo de arquivo CSV</p>
                    <p>NOME,TURMA,MATRICULA</p>
                    <p>João Silva,1ª Série A,12345678</p>
                    <p>Maria Santos,1ª Série A,12345679</p>
                    <p>Pedro Oliveira,1ª Série B,12345680</p>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Aceita separadores: vírgula (,) ou ponto-e-vírgula (;)
                  </p>
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

      {/* Modal Escola (Criar/Editar) */}
      <Dialog
        open={showSchoolModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowSchoolModal(false);
            setSchoolToEdit(null);
            setSchoolForm({ name: '', slug: '', address: '', phone: '', email: '' });
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {schoolToEdit ? 'Editar Escola' : 'Nova Escola'}
            </DialogTitle>
            <DialogDescription>
              {schoolToEdit ? 'Atualize os dados da escola' : 'Preencha os dados da nova escola'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome da Escola *</label>
              <Input
                value={schoolForm.name}
                onChange={(e) => setSchoolForm({ ...schoolForm, name: e.target.value })}
                placeholder="Ex: Colégio São Paulo"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Slug (identificador único) *</label>
              <Input
                value={schoolForm.slug}
                onChange={(e) => setSchoolForm({
                  ...schoolForm,
                  slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
                })}
                placeholder="Ex: colegio-sp"
                className="font-mono"
              />
              <p className="text-xs text-gray-500">Usado para URLs e identificação. Apenas letras minúsculas, números e hífens.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1">
                  <Mail className="h-3 w-3" /> Email
                </label>
                <Input
                  type="email"
                  value={schoolForm.email}
                  onChange={(e) => setSchoolForm({ ...schoolForm, email: e.target.value })}
                  placeholder="contato@escola.com"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1">
                  <Phone className="h-3 w-3" /> Telefone
                </label>
                <Input
                  value={schoolForm.phone}
                  onChange={(e) => setSchoolForm({ ...schoolForm, phone: e.target.value })}
                  placeholder="(11) 99999-9999"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <MapPin className="h-3 w-3" /> Endereço
              </label>
              <Input
                value={schoolForm.address}
                onChange={(e) => setSchoolForm({ ...schoolForm, address: e.target.value })}
                placeholder="Rua, número, bairro - Cidade/UF"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <Button variant="outline" onClick={() => setShowSchoolModal(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSaveSchool}
              disabled={isActionLoading || !schoolForm.name || !schoolForm.slug}
            >
              {isActionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {schoolToEdit ? 'Salvar' : 'Criar Escola'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Simulado (Criar/Editar) */}
      <Dialog
        open={showSimuladoModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowSimuladoModal(false);
            setSimuladoToEdit(null);
            setSimuladoForm({ name: '', description: '', school_id: '', questions_count: 90, start_date: '', end_date: '' });
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              {simuladoToEdit ? 'Editar Simulado' : 'Novo Simulado'}
            </DialogTitle>
            <DialogDescription>
              {simuladoToEdit ? 'Atualize os dados do simulado' : 'Configure o novo simulado'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome do Simulado *</label>
              <Input
                value={simuladoForm.name}
                onChange={(e) => setSimuladoForm({ ...simuladoForm, name: e.target.value })}
                placeholder="Ex: Simulado ENEM 2026 - 1º Bimestre"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Descrição</label>
              <Input
                value={simuladoForm.description}
                onChange={(e) => setSimuladoForm({ ...simuladoForm, description: e.target.value })}
                placeholder="Ex: Simulado preparatório para o ENEM"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Escola *</label>
              <Select
                value={simuladoForm.school_id}
                onValueChange={(value) => setSimuladoForm({ ...simuladoForm, school_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a escola" />
                </SelectTrigger>
                <SelectContent>
                  {schools.map((school) => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Número de Questões</label>
              <Input
                type="number"
                value={simuladoForm.questions_count}
                onChange={(e) => setSimuladoForm({
                  ...simuladoForm,
                  questions_count: parseInt(e.target.value) || 90
                })}
                min={1}
                max={200}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Data Início
                </label>
                <Input
                  type="date"
                  value={simuladoForm.start_date}
                  onChange={(e) => setSimuladoForm({ ...simuladoForm, start_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Data Fim
                </label>
                <Input
                  type="date"
                  value={simuladoForm.end_date}
                  onChange={(e) => setSimuladoForm({ ...simuladoForm, end_date: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <Button variant="outline" onClick={() => setShowSimuladoModal(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSaveSimulado}
              disabled={isActionLoading || !simuladoForm.name || !simuladoForm.school_id}
            >
              {isActionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {simuladoToEdit ? 'Salvar' : 'Criar Simulado'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
