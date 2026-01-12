import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { School, GraduationCap, FileText, Settings, Building2, ChevronLeft, Loader2 } from "lucide-react";
import { authFetch } from "@/lib/authFetch";

export type AppMode = "selector" | "escola" | "enem";

export interface SchoolOption {
  id: string;
  name: string;
  slug: string;
}

export interface ExamOption {
  id: string;
  title: string;
  template_type: string;
  total_questions: number;
  created_at: string;
}

interface ModeSelectorProps {
  onSelect: (mode: "escola" | "enem", schoolId?: string, schoolName?: string, examId?: string, examTitle?: string) => void;
}

export function ModeSelector({ onSelect }: ModeSelectorProps) {
  const [step, setStep] = useState<"mode" | "school">("mode");
  const [selectedMode, setSelectedMode] = useState<"escola" | "enem" | null>(null);
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>("");
  const [loadingSchools, setLoadingSchools] = useState(false);

  // Estado para provas
  const [exams, setExams] = useState<ExamOption[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>("");
  const [loadingExams, setLoadingExams] = useState(false);

  // Carregar escolas quando entrar no passo de seleção de escola
  useEffect(() => {
    if (step === "school") {
      setLoadingSchools(true);
      authFetch("/api/schools")
        .then((res) => res.json())
        .then((data) => {
          if (data.schools) {
            setSchools(data.schools);
          }
        })
        .catch(console.error)
        .finally(() => setLoadingSchools(false));
    }
  }, [step]);

  // Carregar provas quando uma escola é selecionada
  useEffect(() => {
    if (selectedSchoolId) {
      setLoadingExams(true);
      setSelectedExamId("");
      authFetch(`/api/exams?school_id=${selectedSchoolId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.exams) {
            setExams(data.exams);
          }
        })
        .catch(console.error)
        .finally(() => setLoadingExams(false));
    } else {
      setExams([]);
      setSelectedExamId("");
    }
  }, [selectedSchoolId]);

  const handleModeSelect = (mode: "escola" | "enem") => {
    setSelectedMode(mode);
    setStep("school");
  };

  const handleConfirm = () => {
    if (!selectedMode) return;
    const school = schools.find((s) => s.id === selectedSchoolId);
    const exam = exams.find((e) => e.id === selectedExamId);
    onSelect(selectedMode, selectedSchoolId || undefined, school?.name, selectedExamId || undefined, exam?.title);
  };

  // Tela de seleção de escola
  if (step === "school") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-100 dark:from-slate-900 dark:to-slate-800 p-4">
        <div className="max-w-md w-full">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="mx-auto mb-4 p-4 bg-blue-100 dark:bg-blue-900/30 rounded-full w-fit">
              <Building2 className="h-12 w-12 text-blue-600 dark:text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">
              Selecionar Escola
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Escolha a escola para esta correção
            </p>
          </div>

          {/* Card de Seleção */}
          <Card className="bg-white dark:bg-slate-800 border-2">
            <CardContent className="pt-6">
              {loadingSchools ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                  <span className="ml-2 text-slate-600 dark:text-slate-400">Carregando escolas...</span>
                </div>
              ) : (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Escola
                    </label>
                    <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione uma escola..." />
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

                  {schools.length === 0 && (
                    <p className="text-sm text-amber-600 dark:text-amber-400 mb-4">
                      Nenhuma escola cadastrada. Acesse a área de Administração para criar escolas.
                    </p>
                  )}

                  {/* Dropdown de Provas - aparece após selecionar escola */}
                  {selectedSchoolId && (
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Prova (opcional)
                      </label>
                      {loadingExams ? (
                        <div className="flex items-center py-2">
                          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                          <span className="ml-2 text-sm text-slate-500">Carregando provas...</span>
                        </div>
                      ) : (
                        <>
                          <Select value={selectedExamId} onValueChange={setSelectedExamId}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Selecione uma prova ou crie depois..." />
                            </SelectTrigger>
                            <SelectContent>
                              {exams.map((exam) => (
                                <SelectItem key={exam.id} value={exam.id}>
                                  {exam.title} ({exam.total_questions}q)
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {exams.length === 0 && (
                            <p className="text-xs text-slate-500 mt-1">
                              Nenhuma prova cadastrada para esta escola. Você pode criar uma nova prova após iniciar.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  <div className="flex gap-3 mt-6">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setStep("mode");
                        setSelectedMode(null);
                        setSelectedSchoolId("");
                      }}
                      className="flex-1"
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Voltar
                    </Button>
                    <Button
                      onClick={handleConfirm}
                      disabled={!selectedSchoolId}
                      className="flex-1 bg-blue-600 hover:bg-blue-700"
                    >
                      Iniciar Correção
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Modo selecionado */}
          <div className="text-center mt-4 text-sm text-slate-500 dark:text-slate-400">
            Modo: <span className="font-medium">{selectedMode === "enem" ? "ENEM" : "Provas da Escola"}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-100 dark:from-slate-900 dark:to-slate-800 p-4">
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-slate-800 dark:text-slate-100 mb-2">
            XTRI PROVAS
          </h1>
          <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-6">
            Sistema de Correção de Provas
          </p>
          <p className="text-lg text-slate-600 dark:text-slate-400">
            Selecione o modo de trabalho
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* PROVAS DA ESCOLA */}
          <Card
            className="cursor-pointer hover:shadow-2xl transition-all duration-300 hover:scale-[1.02] border-2 hover:border-green-500 bg-white dark:bg-slate-800"
            onClick={() => handleModeSelect("escola")}
          >
            <CardHeader className="text-center pb-2">
              <div className="mx-auto mb-4 p-4 bg-green-100 dark:bg-green-900/30 rounded-full w-fit">
                <School className="h-12 w-12 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle className="text-2xl text-green-700 dark:text-green-400">
                Provas da Escola
              </CardTitle>
              <CardDescription className="text-base">
                Configure provas personalizadas com suas disciplinas
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm">
                <li className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <FileText className="h-4 w-4 text-green-500" />
                  Quantidade de questões livre (5 a 180)
                </li>
                <li className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <Settings className="h-4 w-4 text-green-500" />
                  Disciplinas totalmente customizadas
                </li>
                <li className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <FileText className="h-4 w-4 text-green-500" />
                  Nota máxima configurável (10, 100, etc.)
                </li>
                <li className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <FileText className="h-4 w-4 text-green-500" />
                  TRI adaptado por interpolação
                </li>
                <li className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <FileText className="h-4 w-4 text-green-500" />
                  Usa o mesmo cartão de respostas
                </li>
              </ul>

              <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                  Ideal para provas bimestrais, simulados internos e avaliações personalizadas
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ENEM */}
          <Card
            className="cursor-pointer hover:shadow-2xl transition-all duration-300 hover:scale-[1.02] border-2 hover:border-blue-500 bg-white dark:bg-slate-800"
            onClick={() => handleModeSelect("enem")}
          >
            <CardHeader className="text-center pb-2">
              <div className="mx-auto mb-4 p-4 bg-blue-100 dark:bg-blue-900/30 rounded-full w-fit">
                <GraduationCap className="h-12 w-12 text-blue-600 dark:text-blue-400" />
              </div>
              <CardTitle className="text-2xl text-blue-700 dark:text-blue-400">
                ENEM
              </CardTitle>
              <CardDescription className="text-base">
                Simulados no padrão oficial do ENEM
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm">
                <li className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <FileText className="h-4 w-4 text-blue-500" />
                  Dia 1: Linguagens + Ciências Humanas
                </li>
                <li className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <FileText className="h-4 w-4 text-blue-500" />
                  Dia 2: Natureza + Matemática
                </li>
                <li className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <FileText className="h-4 w-4 text-blue-500" />
                  TRI oficial (tabela ENEM)
                </li>
                <li className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <FileText className="h-4 w-4 text-blue-500" />
                  45 questões por área
                </li>
                <li className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <FileText className="h-4 w-4 text-blue-500" />
                  Merge automático Dia 1 + Dia 2
                </li>
              </ul>

              <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                  Formato oficial do ENEM com LC, CH, CN e MT
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-sm text-slate-500 dark:text-slate-400">
          Você pode trocar de modo a qualquer momento
        </div>
      </div>
    </div>
  );
}
