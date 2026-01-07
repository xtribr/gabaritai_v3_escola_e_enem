import { useState, useCallback } from 'react';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, FileSpreadsheet, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StudentRow {
  matricula: string;
  nome: string;
  turma: string;
  email?: string;
}

interface ValidationError {
  row: number;
  field: string;
  message: string;
}

interface CsvUploaderProps {
  onDataReady: (data: StudentRow[]) => void;
  onCancel?: () => void;
}

const REQUIRED_COLUMNS = ['matricula', 'nome', 'turma'];

export function CsvUploader({ onDataReady, onCancel }: CsvUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<StudentRow[]>([]);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const validateData = useCallback((data: any[]): { valid: StudentRow[]; errors: ValidationError[] } => {
    const errors: ValidationError[] = [];
    const valid: StudentRow[] = [];

    data.forEach((row, index) => {
      const rowNum = index + 2; // +2 porque linha 1 é header e índice começa em 0
      const normalizedRow: any = {};

      // Normalizar nomes das colunas (lowercase, sem espaços)
      Object.keys(row).forEach(key => {
        const normalizedKey = key.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        normalizedRow[normalizedKey] = row[key]?.toString().trim() || '';
      });

      // Verificar colunas obrigatórias
      let hasErrors = false;

      if (!normalizedRow.matricula) {
        errors.push({ row: rowNum, field: 'matricula', message: 'Matrícula é obrigatória' });
        hasErrors = true;
      }

      if (!normalizedRow.nome) {
        errors.push({ row: rowNum, field: 'nome', message: 'Nome é obrigatório' });
        hasErrors = true;
      }

      if (!normalizedRow.turma) {
        errors.push({ row: rowNum, field: 'turma', message: 'Turma é obrigatória' });
        hasErrors = true;
      }

      if (!hasErrors) {
        valid.push({
          matricula: normalizedRow.matricula,
          nome: normalizedRow.nome,
          turma: normalizedRow.turma,
          email: normalizedRow.email || undefined,
        });
      }
    });

    return { valid, errors };
  }, []);

  const processFile = useCallback((file: File) => {
    setParseError(null);
    setValidationErrors([]);
    setParsedData([]);
    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      complete: (results) => {
        if (results.errors.length > 0) {
          setParseError(`Erro ao processar CSV: ${results.errors[0].message}`);
          return;
        }

        if (results.data.length === 0) {
          setParseError('O arquivo CSV está vazio');
          return;
        }

        // Verificar se tem as colunas obrigatórias
        const headers = Object.keys(results.data[0] || {}).map(h =>
          h.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        );

        const missingColumns = REQUIRED_COLUMNS.filter(col => !headers.includes(col));
        if (missingColumns.length > 0) {
          setParseError(`Colunas obrigatórias não encontradas: ${missingColumns.join(', ')}`);
          return;
        }

        const { valid, errors } = validateData(results.data);
        setParsedData(valid);
        setValidationErrors(errors);
      },
      error: (error) => {
        setParseError(`Erro ao ler arquivo: ${error.message}`);
      },
    });
  }, [validateData]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && (file.type === 'text/csv' || file.name.endsWith('.csv'))) {
      processFile(file);
    } else {
      setParseError('Por favor, selecione um arquivo CSV válido');
    }
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  }, [processFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleClear = useCallback(() => {
    setFileName(null);
    setParsedData([]);
    setValidationErrors([]);
    setParseError(null);
  }, []);

  const handleConfirm = useCallback(() => {
    if (parsedData.length > 0) {
      onDataReady(parsedData);
    }
  }, [parsedData, onDataReady]);

  const hasData = parsedData.length > 0 || validationErrors.length > 0;

  return (
    <div className="space-y-4">
      {/* Dropzone */}
      {!hasData && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            'border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
            isDragging
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
              : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'
          )}
        >
          <input
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
            id="csv-upload"
          />
          <label htmlFor="csv-upload" className="cursor-pointer">
            <div className="flex flex-col items-center gap-3">
              <div className={cn(
                'p-4 rounded-full',
                isDragging ? 'bg-blue-100 dark:bg-blue-900' : 'bg-gray-100 dark:bg-gray-800'
              )}>
                <Upload className={cn(
                  'h-8 w-8',
                  isDragging ? 'text-blue-600' : 'text-gray-400'
                )} />
              </div>
              <div>
                <p className="font-medium text-gray-700 dark:text-gray-300">
                  Arraste um arquivo CSV aqui
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  ou clique para selecionar
                </p>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Colunas obrigatórias: matricula, nome, turma
              </p>
            </div>
          </label>
        </div>
      )}

      {/* Parse Error */}
      {parseError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{parseError}</AlertDescription>
        </Alert>
      )}

      {/* File Info & Preview */}
      {hasData && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="h-5 w-5 text-green-600" />
                <div>
                  <CardTitle className="text-base">{fileName}</CardTitle>
                  <CardDescription>
                    {parsedData.length} aluno(s) válido(s)
                    {validationErrors.length > 0 && (
                      <span className="text-red-500 ml-2">
                        • {validationErrors.length} erro(s)
                      </span>
                    )}
                  </CardDescription>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={handleClear}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Validation Errors */}
            {validationErrors.length > 0 && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-medium mb-2">Erros de validação:</div>
                  <ul className="list-disc list-inside text-sm space-y-1">
                    {validationErrors.slice(0, 5).map((error, idx) => (
                      <li key={idx}>
                        Linha {error.row}: {error.message}
                      </li>
                    ))}
                    {validationErrors.length > 5 && (
                      <li>... e mais {validationErrors.length - 5} erro(s)</li>
                    )}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Data Preview Table */}
            {parsedData.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <div className="max-h-64 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Matrícula</TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Turma</TableHead>
                        <TableHead>Email</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedData.slice(0, 10).map((row, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-gray-500">{idx + 1}</TableCell>
                          <TableCell className="font-mono">{row.matricula}</TableCell>
                          <TableCell>{row.nome}</TableCell>
                          <TableCell>{row.turma}</TableCell>
                          <TableCell className="text-gray-500">
                            {row.email || '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {parsedData.length > 10 && (
                  <div className="p-2 text-center text-sm text-gray-500 bg-gray-50 dark:bg-gray-800 border-t">
                    Mostrando 10 de {parsedData.length} registros
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 mt-4">
              {onCancel && (
                <Button variant="outline" onClick={onCancel}>
                  Cancelar
                </Button>
              )}
              <Button
                onClick={handleConfirm}
                disabled={parsedData.length === 0}
                className="gap-2"
              >
                <CheckCircle2 className="h-4 w-4" />
                Confirmar {parsedData.length} aluno(s)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
