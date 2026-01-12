import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { LogOut, Users, GraduationCap, Settings, ArrowLeft, Download, Loader2, CheckCircle2, XCircle, AlertCircle, Search, RefreshCw, KeyRound, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Printer, FileText, Building2, ClipboardList, Plus, Edit2 } from 'lucide-react';
import TrashIcon from '@/components/ui/trash-icon';
import { Link } from 'wouter';
import { CsvUploader, StudentRow } from '@/components/CsvUploader';
import { ProfileMenu } from '@/components/ProfileMenu';

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
  created_at: string;
}

interface Simulado {
  id: string;
  title: string;
  school_id: string;
  schools?: { id: string; name: string };
  status: string;
  total_questions: number;
  template_type: string;
  created_at: string;
  alunos_count?: number;
}

export default function AdminPage() {
  const { profile, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState('escolas');

  // School expansion state
  const [expandedSchoolId, setExpandedSchoolId] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'provas' | 'turmas' | 'alunos'>('provas');

  // CSV Upload states
  const [pendingStudents, setPendingStudents] = useState<StudentRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<ImportResponse | null>(null);
  const [showResultsModal, setShowResultsModal] = useState(false);

  // Students List states (per school)
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

  // Turmas states (per school)
  const [turmasList, setTurmasList] = useState<Turma[]>([]);
  const [isLoadingTurmas, setIsLoadingTurmas] = useState(false);
  const [selectedTurmaForPrint, setSelectedTurmaForPrint] = useState<string | null>(null);
  const [turmaAlunos, setTurmaAlunos] = useState<TurmaAluno[]>([]);
  const [isLoadingTurmaAlunos, setIsLoadingTurmaAlunos] = useState(false);
  const [generatingPdfForTurma, setGeneratingPdfForTurma] = useState<string | null>(null);

  // Schools states
  const [schools, setSchools] = useState<School[]>([]);
  const [isLoadingSchools, setIsLoadingSchools] = useState(false);
  const [schoolToEdit, setSchoolToEdit] = useState<School | null>(null);
  const [showSchoolModal, setShowSchoolModal] = useState(false);
  const [schoolForm, setSchoolForm] = useState({ name: '', slug: '' });

  // Simulados states (per school)
  const [simulados, setSimulados] = useState<Simulado[]>([]);
  const [isLoadingSimulados, setIsLoadingSimulados] = useState(false);
  const [simuladoToEdit, setSimuladoToEdit] = useState<Simulado | null>(null);
  const [showSimuladoModal, setShowSimuladoModal] = useState(false);
  const [simuladoForm, setSimuladoForm] = useState({ title: '', school_id: '', total_questions: 90 });

  // Delete states
  const [schoolToDelete, setSchoolToDelete] = useState<School | null>(null);
  const [simuladoToDelete, setSimuladoToDelete] = useState<Simulado | null>(null);

  // Nova Turma states
  const [showTurmaModal, setShowTurmaModal] = useState(false);
  const [turmaForm, setTurmaForm] = useState({ nome: '' });

  // Novo Aluno states
  const [showAlunoModal, setShowAlunoModal] = useState(false);
  const [alunoForm, setAlunoForm] = useState({ nome: '', matricula: '', turma: '' });

  const isSuperAdmin = profile?.role === 'super_admin';

  const handleLogout = async () => {
    await signOut();
  };

  // Fetch schools
  const fetchSchools = useCallback(async () => {
    setIsLoadingSchools(true);
    try {
      const response = await authFetch('/api/schools');
      const data = await response.json();
      if (data.success) {
        setSchools(data.schools);
      }
    } catch (error) {
      console.error('Erro ao buscar escolas:', error);
    } finally {
      setIsLoadingSchools(false);
    }
  }, []);

  // Fetch turmas for a specific school
  const fetchTurmasForSchool = useCallback(async (schoolId: string) => {
    setIsLoadingTurmas(true);
    try {
      const response = await authFetch(`/api/admin/turmas?school_id=${schoolId}`);
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
  const fetchTurmaAlunos = useCallback(async (turmaNome: string, schoolId: string) => {
    setIsLoadingTurmaAlunos(true);
    try {
      const response = await authFetch(`/api/admin/turmas/${encodeURIComponent(turmaNome)}/alunos?school_id=${schoolId}`);
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
  const handleGenerateGabaritos = async (turmaNome: string, schoolId: string) => {
    setGeneratingPdfForTurma(turmaNome); // Marca qual turma está gerando
    try {
      const response = await authFetch('/api/admin/generate-gabaritos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turma: turmaNome, school_id: schoolId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao gerar gabaritos');
      }

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
      setGeneratingPdfForTurma(null); // Limpa o estado
    }
  };

  // Fetch simulados for a specific school
  const fetchSimuladosForSchool = useCallback(async (schoolId: string) => {
    setIsLoadingSimulados(true);
    try {
      const response = await authFetch(`/api/simulados?school_id=${schoolId}`);
      const data = await response.json();
      if (data.success) {
        setSimulados(data.simulados);
      }
    } catch (error) {
      console.error('Erro ao buscar simulados:', error);
    } finally {
      setIsLoadingSimulados(false);
    }
  }, []);

  // Fetch students for a specific school
  const fetchStudentsForSchool = useCallback(async (schoolId: string, page = 1) => {
    setIsLoadingStudents(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pagination.limit.toString(),
        school_id: schoolId,
      });

      if (selectedTurma && selectedTurma !== 'all') {
        params.append('turma', selectedTurma);
      }

      if (searchTerm) {
        params.append('search', searchTerm);
      }

      const response = await authFetch(`/api/admin/students?${params}`);
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
        setSchoolForm({ name: '', slug: '' });
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
          title: simuladoForm.title,
          school_id: simuladoForm.school_id || expandedSchoolId,
          total_questions: parseInt(String(simuladoForm.total_questions)) || 90,
        }),
      });

      const data = await response.json();
      if (data.success) {
        if (expandedSchoolId) {
          fetchSimuladosForSchool(expandedSchoolId);
        }
        setShowSimuladoModal(false);
        setSimuladoToEdit(null);
        setSimuladoForm({ title: '', school_id: '', total_questions: 90 });
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

  const openEditSchool = (school: School) => {
    setSchoolToEdit(school);
    setSchoolForm({
      name: school.name,
      slug: school.slug,
    });
    setShowSchoolModal(true);
  };

  const openEditSimulado = (simulado: Simulado) => {
    setSimuladoToEdit(simulado);
    setSimuladoForm({
      title: simulado.title,
      school_id: simulado.school_id,
      total_questions: simulado.total_questions,
    });
    setShowSimuladoModal(true);
  };

  // Delete handlers
  const handleDeleteSchool = async () => {
    if (!schoolToDelete) return;

    setIsActionLoading(true);
    try {
      const response = await authFetch(`/api/schools/${schoolToDelete.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (data.success) {
        if (expandedSchoolId === schoolToDelete.id) {
          setExpandedSchoolId(null);
        }
        fetchSchools();
      } else {
        alert(`Erro: ${data.error}`);
      }
    } catch (error) {
      console.error('Erro ao excluir escola:', error);
      alert('Erro ao excluir escola');
    } finally {
      setIsActionLoading(false);
      setSchoolToDelete(null);
    }
  };

  const handleDeleteSimulado = async () => {
    if (!simuladoToDelete) return;

    setIsActionLoading(true);
    try {
      const response = await authFetch(`/api/simulados/${simuladoToDelete.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (data.success) {
        if (expandedSchoolId) {
          fetchSimuladosForSchool(expandedSchoolId);
        }
      } else {
        alert(`Erro: ${data.error}`);
      }
    } catch (error) {
      console.error('Erro ao excluir simulado:', error);
      alert('Erro ao excluir simulado');
    } finally {
      setIsActionLoading(false);
      setSimuladoToDelete(null);
    }
  };

  const handleDeleteStudent = async () => {
    if (!studentToDelete) return;

    setIsActionLoading(true);
    try {
      const response = await authFetch(`/api/admin/students/${studentToDelete.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.success) {
        if (expandedSchoolId) {
          fetchStudentsForSchool(expandedSchoolId, pagination.page);
        }
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

  const handleResetPassword = async () => {
    if (!studentToResetPassword) return;

    setIsActionLoading(true);
    try {
      const response = await authFetch('/api/admin/reset-password', {
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

  // Create new turma
  const handleCreateTurma = async () => {
    if (!turmaForm.nome || !expandedSchoolId) return;

    setIsActionLoading(true);
    try {
      const response = await authFetch('/api/admin/turmas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: turmaForm.nome,
          school_id: expandedSchoolId,
        }),
      });

      const data = await response.json();
      if (data.success) {
        fetchTurmasForSchool(expandedSchoolId);
        setShowTurmaModal(false);
        setTurmaForm({ nome: '' });
      } else {
        alert(`Erro: ${data.error}`);
      }
    } catch (error) {
      console.error('Erro ao criar turma:', error);
      alert('Erro ao criar turma');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Create single student
  const handleCreateAluno = async () => {
    if (!alunoForm.nome || !alunoForm.matricula || !alunoForm.turma || !expandedSchoolId) return;

    setIsActionLoading(true);
    try {
      const response = await authFetch('/api/admin/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: alunoForm.nome,
          matricula: alunoForm.matricula,
          turma: alunoForm.turma,
          school_id: expandedSchoolId,
        }),
      });

      const data = await response.json();
      if (data.success) {
        fetchStudentsForSchool(expandedSchoolId, 1);
        fetchTurmasForSchool(expandedSchoolId);
        setShowAlunoModal(false);
        setAlunoForm({ nome: '', matricula: '', turma: '' });

        // Show password if new student was created
        if (data.senha) {
          alert(`Aluno criado com sucesso!\n\nSenha: ${data.senha}\n\nAnote esta senha, ela não será exibida novamente.`);
        }
      } else {
        alert(`Erro: ${data.error}`);
      }
    } catch (error) {
      console.error('Erro ao criar aluno:', error);
      alert('Erro ao criar aluno');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Handle school expansion
  const handleSchoolExpand = (schoolId: string) => {
    if (expandedSchoolId === schoolId) {
      setExpandedSchoolId(null);
      // Clear data
      setSimulados([]);
      setTurmasList([]);
      setStudents([]);
    } else {
      setExpandedSchoolId(schoolId);
      setActiveSubTab('provas');
      // Load data for this school
      fetchSimuladosForSchool(schoolId);
      fetchTurmasForSchool(schoolId);
      fetchStudentsForSchool(schoolId);
    }
  };

  // Load schools on mount
  useEffect(() => {
    if (activeTab === 'escolas') {
      fetchSchools();
    }
  }, [activeTab, fetchSchools]);

  // Load turma alunos when selected
  useEffect(() => {
    if (selectedTurmaForPrint && expandedSchoolId) {
      fetchTurmaAlunos(selectedTurmaForPrint, expandedSchoolId);
    } else {
      setTurmaAlunos([]);
    }
  }, [selectedTurmaForPrint, expandedSchoolId, fetchTurmaAlunos]);

  // Debounced search for students
  useEffect(() => {
    if (expandedSchoolId && activeSubTab === 'alunos') {
      const timer = setTimeout(() => {
        fetchStudentsForSchool(expandedSchoolId, 1);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [searchTerm, selectedTurma, expandedSchoolId, activeSubTab]);

  // Refresh after import
  useEffect(() => {
    if (showResultsModal === false && importResults?.success && expandedSchoolId) {
      fetchStudentsForSchool(expandedSchoolId, 1);
    }
  }, [showResultsModal]);

  const handleCsvDataReady = (data: StudentRow[]) => {
    setPendingStudents(data);
  };

  const handleImport = async () => {
    if (pendingStudents.length === 0 || !expandedSchoolId) return;

    setIsImporting(true);
    setImportProgress(10);

    try {
      const progressInterval = setInterval(() => {
        setImportProgress(prev => Math.min(prev + 10, 90));
      }, 200);

      const response = await authFetch('/api/admin/import-students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          students: pendingStudents,
          schoolId: expandedSchoolId,
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

  // Sub-tab content renderers
  const renderProvasSubTab = (school: School) => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="font-medium">Provas/Simulados</h4>
        <Button size="sm" onClick={() => {
          setSimuladoToEdit(null);
          setSimuladoForm({ title: '', school_id: school.id, total_questions: 90 });
          setShowSimuladoModal(true);
        }}>
          <Plus className="h-4 w-4 mr-2" />
          Nova Prova
        </Button>
      </div>

      {isLoadingSimulados ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : simulados.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <ClipboardList className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p>Nenhuma prova cadastrada</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Questões</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {simulados.map((simulado) => (
                <TableRow key={simulado.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{simulado.title}</p>
                      <p className="text-xs text-gray-500">{simulado.alunos_count || 0} alunos</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{simulado.total_questions}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={simulado.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                      {simulado.status === 'active' ? 'Ativo' : simulado.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(simulado.created_at).toLocaleDateString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEditSimulado(simulado)} title="Editar">
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      {isSuperAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSimuladoToDelete(simulado)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          title="Excluir"
                        >
                          <TrashIcon size={16} dangerHover />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );

  const renderTurmasSubTab = (school: School) => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="font-medium">Turmas</h4>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchTurmasForSchool(school.id)}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
          <Button size="sm" onClick={() => {
            setTurmaForm({ nome: '' });
            setShowTurmaModal(true);
          }}>
            <Plus className="h-4 w-4 mr-2" />
            Nova Turma
          </Button>
        </div>
      </div>

      {isLoadingTurmas ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : turmasList.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <GraduationCap className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p>Nenhuma turma encontrada</p>
          <p className="text-sm">Crie uma turma ou importe alunos</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {turmasList.map((turma) => (
              <Card key={turma.nome} className="relative overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{turma.nome}</CardTitle>
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
                      <Users className="h-4 w-4 mr-1" />
                      Ver
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleGenerateGabaritos(turma.nome, school.id);
                      }}
                      disabled={generatingPdfForTurma !== null}
                    >
                      {generatingPdfForTurma === turma.nome ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Printer className="h-4 w-4 mr-1" />
                      )}
                      Gabaritos
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Lista de alunos da turma selecionada */}
          {selectedTurmaForPrint && (
            <Card className="mt-4">
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Alunos - {selectedTurmaForPrint}</CardTitle>
                    <CardDescription className="text-sm">
                      {turmaAlunos.length} aluno(s)
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedTurmaForPrint(null)}>
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {isLoadingTurmaAlunos ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
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
                            <TableCell className="font-mono text-sm">{aluno.student_number || '-'}</TableCell>
                            <TableCell>{aluno.name}</TableCell>
                            <TableCell className="text-sm text-gray-500">{aluno.email}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );

  const renderAlunosSubTab = (school: School) => (
    <div className="space-y-4">
      {/* Header com botões */}
      <div className="flex justify-between items-center">
        <h4 className="font-medium">Alunos</h4>
        <Button size="sm" onClick={() => {
          setAlunoForm({ nome: '', matricula: '', turma: '' });
          setShowAlunoModal(true);
        }}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Aluno
        </Button>
      </div>

      {/* Import CSV */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Importar em Lote (CSV)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <CsvUploader
            onDataReady={handleCsvDataReady}
            onCancel={() => setPendingStudents([])}
          />

          {pendingStudents.length > 0 && (
            <div className="pt-3 border-t">
              {isImporting ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-sm">Importando {pendingStudents.length} aluno(s)...</span>
                  </div>
                  <Progress value={importProgress} className="h-2" />
                </div>
              ) : (
                <Button onClick={handleImport} size="sm">
                  <Users className="h-4 w-4 mr-2" />
                  Importar {pendingStudents.length} Aluno(s)
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Students List */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
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
                <SelectItem key={turma} value={turma}>{turma}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoadingStudents ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : students.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Users className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>Nenhum aluno encontrado</p>
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
                      <TableCell className="font-mono text-sm">{student.student_number || '-'}</TableCell>
                      <TableCell>{student.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{student.turma || '-'}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">{student.email}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setStudentToResetPassword(student)} title="Resetar senha">
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          {isSuperAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setStudentToDelete(student)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="Remover"
                            >
                              <TrashIcon size={16} dangerHover />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-sm text-gray-500">
                  Página {pagination.page} de {pagination.totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page === 1}
                    onClick={() => fetchStudentsForSchool(school.id, pagination.page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page === pagination.totalPages}
                    onClick={() => fetchStudentsForSchool(school.id, pagination.page + 1)}
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
  );

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
                  XTRI PROVAS Admin
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Painel Administrativo
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <ProfileMenu />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 max-w-xs">
            <TabsTrigger value="escolas" className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Escolas
            </TabsTrigger>
            <TabsTrigger value="configuracoes" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Config
            </TabsTrigger>
          </TabsList>

          <TabsContent value="escolas" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <CardTitle>Gestão de Escolas</CardTitle>
                    <CardDescription>
                      {schools.length} escola(s) cadastrada(s) - Clique para expandir
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={fetchSchools}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Atualizar
                    </Button>
                    {isSuperAdmin && (
                      <Button size="sm" onClick={() => {
                        setSchoolToEdit(null);
                        setSchoolForm({ name: '', slug: '' });
                        setShowSchoolModal(true);
                      }}>
                        <Plus className="h-4 w-4 mr-2" />
                        Nova Escola
                      </Button>
                    )}
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
                    {isSuperAdmin && <p className="text-sm mt-2">Clique em "Nova Escola" para adicionar</p>}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {schools.map((school) => (
                      <Collapsible
                        key={school.id}
                        open={expandedSchoolId === school.id}
                        onOpenChange={() => handleSchoolExpand(school.id)}
                      >
                        <div className="border rounded-lg overflow-hidden">
                          <CollapsibleTrigger asChild>
                            <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                              <div className="flex items-center gap-3">
                                {expandedSchoolId === school.id ? (
                                  <ChevronUp className="h-5 w-5 text-gray-400" />
                                ) : (
                                  <ChevronDown className="h-5 w-5 text-gray-400" />
                                )}
                                <div>
                                  <p className="font-medium">{school.name}</p>
                                  <p className="text-sm text-gray-500">{school.slug}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                {isSuperAdmin && (
                                  <>
                                    <Button variant="ghost" size="sm" onClick={() => openEditSchool(school)} title="Editar">
                                      <Edit2 className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setSchoolToDelete(school)}
                                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                      title="Excluir"
                                    >
                                      <TrashIcon size={16} dangerHover />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          </CollapsibleTrigger>

                          <CollapsibleContent>
                            <div className="border-t bg-gray-50/50 dark:bg-gray-800/50 p-4">
                              {/* Sub-tabs */}
                              <Tabs value={activeSubTab} onValueChange={(v) => setActiveSubTab(v as 'provas' | 'turmas' | 'alunos')}>
                                <TabsList className="grid w-full grid-cols-3 max-w-md mb-4">
                                  <TabsTrigger value="provas" className="flex items-center gap-2">
                                    <ClipboardList className="h-4 w-4" />
                                    Provas
                                  </TabsTrigger>
                                  <TabsTrigger value="turmas" className="flex items-center gap-2">
                                    <GraduationCap className="h-4 w-4" />
                                    Turmas
                                  </TabsTrigger>
                                  <TabsTrigger value="alunos" className="flex items-center gap-2">
                                    <Users className="h-4 w-4" />
                                    Alunos
                                  </TabsTrigger>
                                </TabsList>

                                <TabsContent value="provas">
                                  {renderProvasSubTab(school)}
                                </TabsContent>

                                <TabsContent value="turmas">
                                  {renderTurmasSubTab(school)}
                                </TabsContent>

                                <TabsContent value="alunos">
                                  {renderAlunosSubTab(school)}
                                </TabsContent>
                              </Tabs>
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="configuracoes" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Configurações
                </CardTitle>
                <CardDescription>
                  Configurações gerais do sistema
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Instruções */}
                <div>
                  <h3 className="text-sm font-medium mb-4">Como usar o sistema</h3>
                  <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                    <div className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">1</span>
                      <p><strong>Selecione uma escola:</strong> Clique na escola para expandir e ver suas opções</p>
                    </div>
                    <div className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">2</span>
                      <p><strong>Importe alunos:</strong> Na aba "Alunos", faça upload de CSV com nome, turma e matrícula</p>
                    </div>
                    <div className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">3</span>
                      <p><strong>Imprima gabaritos:</strong> Na aba "Turmas", clique em "Gabaritos" para gerar PDFs</p>
                    </div>
                    <div className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">4</span>
                      <p><strong>Crie provas:</strong> Na aba "Provas", cadastre simulados e gerencie resultados</p>
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

      {/* AlertDialog Confirmar Exclusão de Aluno */}
      <AlertDialog open={!!studentToDelete} onOpenChange={(open) => !open && setStudentToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Aluno</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover <strong>{studentToDelete?.name}</strong>?
              <br />
              Esta ação não pode ser desfeita.
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
            setSchoolForm({ name: '', slug: '' });
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
              <label className="text-sm font-medium">Slug (identificador) *</label>
              <Input
                value={schoolForm.slug}
                onChange={(e) => setSchoolForm({
                  ...schoolForm,
                  slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
                })}
                placeholder="Ex: colegio-sp"
                className="font-mono"
              />
              <p className="text-xs text-gray-500">Apenas letras minúsculas, números e hífens.</p>
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
            setSimuladoForm({ title: '', school_id: '', total_questions: 90 });
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              {simuladoToEdit ? 'Editar Prova' : 'Nova Prova'}
            </DialogTitle>
            <DialogDescription>
              {simuladoToEdit ? 'Atualize os dados da prova' : 'Configure a nova prova'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Título da Prova *</label>
              <Input
                value={simuladoForm.title}
                onChange={(e) => setSimuladoForm({ ...simuladoForm, title: e.target.value })}
                placeholder="Ex: Simulado ENEM 2026 - 1º Bimestre"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Número de Questões</label>
              <Input
                type="number"
                value={simuladoForm.total_questions}
                onChange={(e) => setSimuladoForm({
                  ...simuladoForm,
                  total_questions: parseInt(e.target.value) || 90
                })}
                min={1}
                max={200}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <Button variant="outline" onClick={() => setShowSimuladoModal(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSaveSimulado}
              disabled={isActionLoading || !simuladoForm.title}
            >
              {isActionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {simuladoToEdit ? 'Salvar' : 'Criar Prova'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* AlertDialog Confirmar Exclusão de Escola */}
      <AlertDialog open={!!schoolToDelete} onOpenChange={(open) => !open && setSchoolToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Escola</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a escola <strong>{schoolToDelete?.name}</strong>?
              <br />
              <span className="text-red-600 font-medium">
                Esta ação não pode ser desfeita. Todos os dados vinculados serão perdidos.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSchool}
              className="bg-red-600 hover:bg-red-700"
              disabled={isActionLoading}
            >
              {isActionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog Confirmar Exclusão de Simulado */}
      <AlertDialog open={!!simuladoToDelete} onOpenChange={(open) => !open && setSimuladoToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Prova</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a prova <strong>{simuladoToDelete?.title}</strong>?
              <br />
              <span className="text-red-600 font-medium">
                Esta ação não pode ser desfeita. Todas as respostas serão perdidas.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSimulado}
              className="bg-red-600 hover:bg-red-700"
              disabled={isActionLoading}
            >
              {isActionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal Nova Turma */}
      <Dialog
        open={showTurmaModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowTurmaModal(false);
            setTurmaForm({ nome: '' });
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5" />
              Nova Turma
            </DialogTitle>
            <DialogDescription>
              Crie uma nova turma para esta escola
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome da Turma *</label>
              <Input
                value={turmaForm.nome}
                onChange={(e) => setTurmaForm({ ...turmaForm, nome: e.target.value })}
                placeholder="Ex: 1ª Série A"
              />
              <p className="text-xs text-gray-500">Use o formato: Série + Letra (ex: 1ª Série A, 2ª Série B)</p>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <Button variant="outline" onClick={() => setShowTurmaModal(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreateTurma}
              disabled={isActionLoading || !turmaForm.nome}
            >
              {isActionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar Turma
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Novo Aluno */}
      <Dialog
        open={showAlunoModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowAlunoModal(false);
            setAlunoForm({ nome: '', matricula: '', turma: '' });
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Novo Aluno
            </DialogTitle>
            <DialogDescription>
              Cadastre um novo aluno nesta escola
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome Completo *</label>
              <Input
                value={alunoForm.nome}
                onChange={(e) => setAlunoForm({ ...alunoForm, nome: e.target.value })}
                placeholder="Ex: João Silva"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Matrícula *</label>
              <Input
                value={alunoForm.matricula}
                onChange={(e) => setAlunoForm({ ...alunoForm, matricula: e.target.value })}
                placeholder="Ex: 12345678"
                className="font-mono"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Turma *</label>
              <Select
                value={alunoForm.turma}
                onValueChange={(value) => setAlunoForm({ ...alunoForm, turma: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma turma" />
                </SelectTrigger>
                <SelectContent>
                  {turmasList.map((t) => (
                    <SelectItem key={t.nome} value={t.nome}>{t.nome}</SelectItem>
                  ))}
                  {turmasList.length === 0 && (
                    <SelectItem value="_none" disabled>Nenhuma turma cadastrada</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">Crie uma turma primeiro se necessário</p>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <Button variant="outline" onClick={() => setShowAlunoModal(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreateAluno}
              disabled={isActionLoading || !alunoForm.nome || !alunoForm.matricula || !alunoForm.turma}
            >
              {isActionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar Aluno
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
