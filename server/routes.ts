import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { ExcelExporter } from "./src/reports/excelExporter.js";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import archiver from "archiver";
import type { StudentData, ExamStatistics } from "@shared/schema";
import { officialGabaritoTemplate } from "@shared/schema";
import { extractTextFromImageDeepSeek, checkOCRService } from "./deepseekOCR.js";
// 🆕 Abordagem Híbrida: OMR (OpenCV) + Header (GPT Vision)
import { extractHeaderInfoWithGPT, callChatGPTVisionOMR } from "./chatgptOMR.js";
import { registerDebugRoutes } from "./debugRoutes.js";
import { gerarAnaliseDetalhada } from "./conteudosLoader.js";
import { storage } from "./storage.js";
import { supabaseAdmin } from "./lib/supabase.js";
import {
  parseStudentCSV,
  createAnswerSheetBatch,
  generateBatchPDF,
  generateSheetCode,
  getBatchById,
  getStudentsByBatchId,
  getStudentBySheetCode,
  updateStudentAnswers,
} from "./src/answerSheetBatch.js";
import { requireAuth, requireRole, requireSchoolAccess, type AuthenticatedRequest } from "./lib/auth.js";
import { isTurmaAllowed } from "./lib/seriesFilter.js";
import {
  transformStudentsForSupabase,
  transformStudentFromSupabase,
  calculateBlankAnswers,
  type StudentDataFrontend,
  type StudentAnswerSupabase
} from "@shared/transforms";

// Configuração dos serviços Python
// Modal.com - ASGI app com FastAPI
const USE_MODAL = process.env.USE_MODAL === "true";
const MODAL_OMR_HEALTH_URL = "https://xtribr--omr-api.modal.run/health";
const MODAL_OMR_PROCESS_URL = "https://xtribr--omr-api.modal.run/process-image";

const PYTHON_OMR_SERVICE_URL = process.env.PYTHON_OMR_URL || "http://localhost:5002";
const PYTHON_TRI_SERVICE_URL = process.env.PYTHON_TRI_URL || "http://localhost:5003";
const USE_PYTHON_OMR = process.env.USE_PYTHON_OMR !== "false"; // Ativado por padrão
const USE_PYTHON_TRI = process.env.USE_PYTHON_TRI !== "false"; // Ativado por padrão

// Log de configuração na inicialização
console.log(`[CONFIG] 🔧 Configuração dos serviços Python:`);
console.log(`[CONFIG]   - USE_MODAL: ${USE_MODAL}`);
if (USE_MODAL) {
  console.log(`[CONFIG]   - MODAL_OMR_HEALTH: ${MODAL_OMR_HEALTH_URL}`);
  console.log(`[CONFIG]   - MODAL_OMR_PROCESS: ${MODAL_OMR_PROCESS_URL}`);
} else {
  console.log(`[CONFIG]   - PYTHON_OMR_URL: ${PYTHON_OMR_SERVICE_URL}`);
}
console.log(`[CONFIG]   - PYTHON_TRI_URL: ${PYTHON_TRI_SERVICE_URL}`);
console.log(`[CONFIG]   - USE_PYTHON_OMR: ${USE_PYTHON_OMR}`);
console.log(`[CONFIG]   - USE_PYTHON_TRI: ${USE_PYTHON_TRI}`);

/**
 * Chama o serviço Python OMR para processar uma imagem
 * @param imageBuffer Buffer da imagem PNG
 * @param pageNumber Número da página
 * @param config Nome da configuração (ex: 'default', 'modelo_menor')
 * @returns Resposta do OMR no formato do serviço Python
 */
async function callPythonOMR(imageBuffer: Buffer, pageNumber: number, config: string = "default"): Promise<{
  status: string;
  pagina?: {
    pagina: number;
    resultado: {
      questoes: Record<string, string>;
    };
    header?: {
      nome: string | null;
      turma: string | null;
      matricula: string | null;
    };
  };
  mensagem?: string;
}> {
  try {
    // Usar axios que tem melhor suporte para multipart/form-data
    const axios = (await import("axios")).default;
    const FormData = (await import("form-data")).default;
    const formData = new FormData();

    // Adicionar imagem como buffer
    formData.append("image", imageBuffer, {
      filename: `page_${pageNumber}.png`,
      contentType: "image/png",
    });

    // Adicionar número da página como campo de formulário
    formData.append("page", pageNumber.toString());

    // Adicionar configuração
    formData.append("config", config);

    // Determinar URL baseado se usa Modal ou Fly.io
    const omrUrl = USE_MODAL ? MODAL_OMR_PROCESS_URL : `${PYTHON_OMR_SERVICE_URL}/api/process-image`;
    console.log(`[Python OMR] Enviando imagem de ${imageBuffer.length} bytes para página ${pageNumber} (${USE_MODAL ? 'Modal' : 'Fly.io'})...`);

    // Usar axios que trata form-data corretamente
    const response = await axios.post(
      omrUrl,
      formData,
      {
        timeout: 120000, // 120 segundos timeout (Modal pode ter cold start)
        headers: {
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    return response.data;
  } catch (error: any) {
    const omrUrl = USE_MODAL ? MODAL_OMR_PROCESS_URL : `${PYTHON_OMR_SERVICE_URL}/api/process-image`;
    console.error(`[Python OMR] ❌ ERRO ao chamar serviço em ${omrUrl}:`, error.message || error);
    console.error(`[Python OMR] Código:`, error.code || 'N/A');
    console.error(`[Python OMR] URL tentada:`, omrUrl);
    if (error.response) {
      console.error(`[Python OMR] Response status:`, error.response.status);
      console.error(`[Python OMR] Response data:`, JSON.stringify(error.response.data));
      throw new Error(`Serviço Python OMR retornou erro ${error.response.status}: ${JSON.stringify(error.response.data)}`);
    }
    if (error.code === 'ECONNREFUSED') {
      throw new Error(`Conexão recusada pelo OMR em ${PYTHON_OMR_SERVICE_URL}. Verifique se o serviço está rodando.`);
    }
    if (error.code === 'ENOTFOUND') {
      throw new Error(`Host não encontrado: ${PYTHON_OMR_SERVICE_URL}. Verifique a URL.`);
    }
    throw new Error(`Erro de conexão com OMR: ${error.message || error}`);
  }
}

/**
 * Chama o serviço Python OMR com leitura de QR Code
 * Usa o endpoint /api/process-sheet que lê QR + OMR + busca aluno no Supabase
 */
async function callPythonOMRWithQR(imageBuffer: Buffer, pageNumber: number): Promise<{
  status: string;
  sheet_code?: string;
  student?: {
    student_name: string | null;
    enrollment: string | null;
    class_name: string | null;
    exam_id: string | null;
  } | null;
  answers?: (string | null)[];
  stats?: {
    answered: number;
    blank: number;
    double_marked: number;
  };
  timings?: Record<string, number>;
  saved?: boolean;
  code?: string;
  message?: string;
}> {
  try {
    const axios = (await import("axios")).default;
    const FormData = (await import("form-data")).default;
    const formData = new FormData();

    formData.append("image", imageBuffer, {
      filename: `page_${pageNumber}.png`,
      contentType: "image/png",
    });

    const omrUrl = `${PYTHON_OMR_SERVICE_URL}/api/process-sheet`;
    console.log(`[Python OMR+QR] Enviando imagem de ${imageBuffer.length} bytes para página ${pageNumber}...`);

    const response = await axios.post(omrUrl, formData, {
      timeout: 120000,
      headers: formData.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    return response.data;
  } catch (error: any) {
    console.error(`[Python OMR+QR] ❌ ERRO:`, error.message || error);
    if (error.response?.data) {
      // Retornar erro da API para tratamento
      return error.response.data;
    }
    throw new Error(`Erro de conexão com OMR: ${error.message || error}`);
  }
}

/**
 * Chama o serviço Python OMR com retry e backoff exponencial
 */
async function callPythonOMRWithRetry(
  imageBuffer: Buffer,
  pageNumber: number,
  config: string = "default",
  maxRetries: number = 3
): Promise<ReturnType<typeof callPythonOMR>> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callPythonOMR(imageBuffer, pageNumber, config);
    } catch (error: any) {
      lastError = error;

      if (attempt === maxRetries) {
        console.error(`[OMR Retry] ❌ Todas as ${maxRetries} tentativas falharam para página ${pageNumber}`);
        throw error;
      }

      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      console.warn(`[OMR Retry] ⚠️ Tentativa ${attempt}/${maxRetries} falhou para página ${pageNumber}. Aguardando ${delay}ms...`);
      console.warn(`[OMR Retry] Erro: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Erro desconhecido no retry');
}

/**
 * Verifica se o serviço Python OMR está disponível
 */
async function checkPythonOMRService(): Promise<boolean> {
  try {
    const healthUrl = USE_MODAL ? MODAL_OMR_HEALTH_URL : `${PYTHON_OMR_SERVICE_URL}/health`;
    console.log(`[OMR Health] Verificando ${healthUrl} (${USE_MODAL ? 'Modal' : 'Fly.io'})...`);
    const response = await fetch(healthUrl, {
      method: "GET",
      signal: AbortSignal.timeout(30000), // 30 segundos timeout (Modal pode ter cold start)
    });
    if (response.ok) {
      console.log(`[OMR Health] ✅ Serviço disponível (status ${response.status})`);
    } else {
      console.warn(`[OMR Health] ⚠️ Serviço retornou status ${response.status}`);
    }
    return response.ok;
  } catch (error) {
    console.error(`[OMR Health] ❌ FALHA na conexão:`, error);
    return false;
  }
}

/**
 * Verifica se o serviço Python TRI V2 está disponível
 */
async function checkPythonTRIService(): Promise<boolean> {
  try {
    const response = await fetch(`${PYTHON_TRI_SERVICE_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000), // 3 segundos timeout
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Chama o serviço Python TRI V2 para calcular TRI com coerência pedagógica
 */
async function callPythonTRI(
  alunos: Array<Record<string, any>>,
  gabarito: Record<string, string>,
  areasConfig?: Record<string, [number, number]>
): Promise<{
  status: string;
  total_alunos?: number;
  prova_analysis?: any;
  resultados?: Array<any>;
  mensagem?: string;
}> {
  try {
    const axios = (await import("axios")).default;

    const response = await axios.post(
      `${PYTHON_TRI_SERVICE_URL}/api/calcular-tri`,
      {
        alunos,
        gabarito,
        areas_config: areasConfig || {
          'LC': [1, 45],
          'CH': [46, 90],
          'CN': [1, 45],
          'MT': [46, 90]
        }
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000, // 30s timeout
      }
    );

    return response.data;
  } catch (error: any) {
    console.error("[TRI SERVICE] Erro ao chamar serviço Python TRI:", error.message);
    return {
      status: "erro",
      mensagem: error.response?.data?.mensagem || error.message
    };
  }
}

/**
 * Converte resposta do Python OMR para formato interno
 */
function convertPythonOMRToInternal(
  pythonResult: {
    status: string;
    sucesso?: boolean;
    pagina?: {
      numero?: number;
      resultado: {
        questoes: Array<{ numero: number; resposta: string }> | Record<string, string>
      }
    };
    estatisticas?: any;
    mensagem?: string;
  },
  totalQuestions: number = 90
): { detectedAnswers: (string | null)[]; overallConfidence: number; warnings: string[] } {
  // Verifica se há dados da página
  if (!pythonResult.pagina && !pythonResult.sucesso) {
    return {
      detectedAnswers: Array(totalQuestions).fill(null),
      overallConfidence: 0,
      warnings: [pythonResult.mensagem || "Erro ao processar com Python OMR"],
    };
  }

  const questoes = pythonResult.pagina?.resultado?.questoes;
  const detectedAnswers: (string | null)[] = [];
  const warnings: string[] = [];
  let answeredCount = 0;

  // Verifica se questões é um array (novo formato) ou objeto (formato antigo)
  const isArrayFormat = Array.isArray(questoes);

  console.log(`[DEBUG CONVERSION] Formato: ${isArrayFormat ? 'ARRAY' : 'OBJETO'}`);
  console.log(`[DEBUG CONVERSION] Total de questões: ${isArrayFormat ? questoes.length : Object.keys(questoes || {}).length}`);

  if (isArrayFormat) {
    // NOVO FORMATO: Array de objetos [{numero: 1, resposta: "A"}, ...]
    console.log(`[DEBUG CONVERSION] Primeiras 5 questões:`, questoes.slice(0, 5).map((q: any) => `Q${q.numero}=${q.resposta}`).join(", "));

    // Cria mapa de questões
    const questoesMap = new Map<number, string>();
    for (const q of questoes) {
      if (q && typeof q === 'object' && 'numero' in q && 'resposta' in q) {
        questoesMap.set(q.numero, q.resposta);
      }
    }

    for (let i = 1; i <= totalQuestions; i++) {
      const answer = questoesMap.get(i);
      const normalizedAnswer = answer ? String(answer).trim().toUpperCase() : null;

      // Aceitar A-E como respostas válidas
      if (normalizedAnswer && /^[A-E]$/.test(normalizedAnswer)) {
        detectedAnswers.push(normalizedAnswer);
        answeredCount++;
      }
      // Aceitar "X" como dupla marcação (resposta inválida do aluno)
      else if (normalizedAnswer === "X") {
        detectedAnswers.push("X");
        warnings.push(`Questão ${i}: DUPLA MARCAÇÃO detectada`);
      }
      // Questão em branco
      else {
        detectedAnswers.push(null);
      }
    }
  } else {
    // FORMATO ANTIGO: Objeto {1: "A", 2: "B", ...}
    const questoesObj = questoes as Record<string, string>;
    console.log(`[DEBUG CONVERSION] Primeiras 5 questões:`, Object.keys(questoesObj).slice(0, 5).map(k => `Q${k}=${questoesObj[k]}`).join(", "));

    for (let i = 1; i <= totalQuestions; i++) {
      const answer = questoesObj[String(i)];
      const normalizedAnswer = answer ? String(answer).trim().toUpperCase() : null;

      // Aceitar A-E como respostas válidas
      if (normalizedAnswer && /^[A-E]$/.test(normalizedAnswer)) {
        detectedAnswers.push(normalizedAnswer);
        answeredCount++;
      }
      // Aceitar "X" ou "DUPLA MARCAÇÃO" como dupla marcação
      else if (normalizedAnswer === "X" || normalizedAnswer === "DUPLA MARCAÇÃO" || normalizedAnswer === "DUPLA MARCACAO") {
        detectedAnswers.push("X");
        warnings.push(`Questão ${i}: DUPLA MARCAÇÃO detectada`);
      }
      // Questão em branco
      else {
        detectedAnswers.push(null);
      }
    }
  }

  // VALIDAÇÃO CRÍTICA: Garantir que sempre retornamos exatamente totalQuestions elementos
  if (detectedAnswers.length !== totalQuestions) {
    console.error(`[DEBUG CONVERSION] ERRO CRÍTICO: detectedAnswers tem ${detectedAnswers.length} elementos, mas deveria ter ${totalQuestions}`);
    // Ajustar tamanho - adicionar se faltar
    while (detectedAnswers.length < totalQuestions) {
      detectedAnswers.push(null);
    }
    // Remover se sobrar
    while (detectedAnswers.length > totalQuestions) {
      detectedAnswers.pop();
    }
  }

  // DEBUG: Log estatísticas finais
  console.log(`[DEBUG CONVERSION] Respostas válidas detectadas: ${answeredCount}/${totalQuestions}`);
  console.log(`[DEBUG CONVERSION] Tamanho final do array: ${detectedAnswers.length} (esperado: ${totalQuestions})`);

  // Log das primeiras 10 questões para debug
  const first10 = detectedAnswers.slice(0, 10).map((ans, idx) => `Q${idx + 1}="${ans || 'null'}"`).join(", ");
  console.log(`[DEBUG CONVERSION] Primeiras 10 questões: ${first10}`);

  // Nova fórmula de confiança baseada na força da detecção
  // Range: 0.70 a 0.98 proporcional às respostas detectadas
  const doubleMarkedCount = detectedAnswers.filter(a => a === "X").length;
  const answerRatio = answeredCount / totalQuestions;

  // Base 0.70 + até 0.28 adicional (máximo 98%)
  let confidence = 0.70 + (answerRatio * 0.28);

  // Penalidade por dupla marcação (indica problemas de leitura)
  confidence -= (doubleMarkedCount * 0.015);

  // Limitar ao range válido
  confidence = Math.max(0.40, Math.min(0.98, confidence));

  const overallConfidence = answeredCount > 0 ? confidence : 0.40;

  return {
    detectedAnswers,
    overallConfidence,
    warnings: warnings.slice(0, 10), // Limitar warnings
  };
}
import { join } from "path";
// Módulos organizados
import { TRICalculator } from "./src/calculations/triCalculator.js";
import { TCTCalculator } from "./src/calculations/tctCalculator.js";
import { TRIProcessor } from "./src/processors/triProcessor.js";
import { QuestionStatsProcessor } from "./src/processors/questionStatsProcessor.js";

// Job storage for async PDF processing
interface ProcessingJob {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  progress: number;
  currentPage: number;
  totalPages: number;
  students: StudentData[];
  warnings: string[];
  errorMessage?: string;
  createdAt: Date;
  // Detalhes do último processamento para o console do frontend
  lastPageResult?: {
    detectedAnswers: Array<string | null>;
    overallConfidence: number;
    scanQuality?: {
      quality: string;
      issues: string[];
      canProcess: boolean;
    };
    corrections?: Array<{ q: number; omr: string | null; corrected: string | null; reason?: string }>;
  };
}

const jobs = new Map<string, ProcessingJob>();

// Cleanup old jobs after 1 hour
setInterval(() => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  Array.from(jobs.entries()).forEach(([id, job]) => {
    if (job.createdAt < oneHourAgo) {
      jobs.delete(id);
    }
  });
}, 60 * 1000);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    console.log(`[UPLOAD] Recebendo arquivo: ${file.originalname}, tipo: ${file.mimetype}`);
    const isPDF = file.mimetype === "application/pdf";
    const isImage = file.mimetype.startsWith("image/") &&
      (file.mimetype === "image/jpeg" ||
        file.mimetype === "image/png" ||
        file.mimetype === "image/webp");

    if (isPDF || isImage) {
      cb(null, true);
    } else {
      cb(new Error("Apenas arquivos PDF e imagens (JPG, PNG, WebP) são aceitos"));
    }
  },
});

const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for CSV
  },
  fileFilter: (req, file, cb) => {
    console.log(`[UPLOAD CSV] Recebendo arquivo: ${file.originalname}, tipo: ${file.mimetype}`);
    const isCSV = file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.originalname.toLowerCase().endsWith(".csv");
    if (isCSV) {
      cb(null, true);
    } else {
      cb(new Error("Apenas arquivos CSV são aceitos"));
    }
  },
});

interface OCRResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    confidence: number;
    bbox?: { x0: number; y0: number; x1: number; y1: number };
  }>;
}

async function extractTextFromImage(imageBuffer: Buffer): Promise<OCRResult> {
  try {
    console.log("[OCR] Usando DeepSeek-OCR para extrair texto...");
    const result = await extractTextFromImageDeepSeek(imageBuffer, "<image>\nFree OCR.");

    return {
      text: result.text,
      confidence: result.confidence,
      words: (result.words || []).map(w => ({
        text: w.text,
        confidence: w.confidence,
        bbox: w.bbox,
      })),
    };
  } catch (error) {
    console.error("[OCR] Erro ao processar com DeepSeek-OCR:", error);
    return { text: "", confidence: 0, words: [] };
  }
}

function parseStudentData(ocrResult: OCRResult, pageNumber: number): StudentData[] {
  const students: StudentData[] = [];
  const text = ocrResult.text;
  const lines = text.split("\n").filter((line) => line.trim());
  const overallConfidence = ocrResult.confidence;

  let currentStudent: Partial<StudentData> | null = null;

  for (const line of lines) {
    const numberMatch = line.match(/(?:N[úu]mero|Inscri[çc][ãa]o|Matr[íi]cula)[\s:]*(\d+)/i);
    const nameMatch = line.match(/(?:Nome|Aluno|Candidato)[\s:]*([A-Za-zÀ-ÿ\s]+)/i);
    const answerMatch = line.match(/^[A-E\s,.-]+$/i);
    const numberedAnswerMatch = line.match(/^\d+[\s.)-]+([A-E])/i);
    const multipleAnswersMatch = line.match(/([A-E][\s,.-]*)+/gi);

    if (numberMatch) {
      if (currentStudent && currentStudent.studentNumber) {
        students.push({
          id: randomUUID(),
          studentNumber: currentStudent.studentNumber,
          studentName: currentStudent.studentName || "Não identificado",
          answers: currentStudent.answers || [],
          pageNumber,
          rawText: currentStudent.rawText,
          confidence: overallConfidence,
        });
      }
      currentStudent = {
        studentNumber: numberMatch[1],
        studentName: "",
        answers: [],
        rawText: line,
        confidence: overallConfidence,
      };
    }

    if (nameMatch && currentStudent) {
      currentStudent.studentName = nameMatch[1].trim();
    }

    if (currentStudent) {
      if (numberedAnswerMatch) {
        currentStudent.answers = currentStudent.answers || [];
        currentStudent.answers.push(numberedAnswerMatch[1].toUpperCase());
      } else if (multipleAnswersMatch) {
        const answers = line
          .toUpperCase()
          .split(/[\s,.-]+/)
          .filter((a) => /^[A-E]$/.test(a));
        if (answers.length > 0) {
          currentStudent.answers = currentStudent.answers || [];
          currentStudent.answers.push(...answers);
        }
      }
    }
  }

  if (currentStudent && currentStudent.studentNumber) {
    students.push({
      id: randomUUID(),
      studentNumber: currentStudent.studentNumber,
      studentName: currentStudent.studentName || "Não identificado",
      answers: currentStudent.answers || [],
      pageNumber,
      rawText: currentStudent.rawText,
      confidence: overallConfidence,
    });
  }

  if (students.length === 0) {
    const allAnswers = text
      .toUpperCase()
      .match(/[A-E]/g) || [];

    if (allAnswers.length >= 5) {
      students.push({
        id: randomUUID(),
        studentNumber: `P${pageNumber.toString().padStart(3, "0")}`,
        studentName: `Aluno Página ${pageNumber}`,
        answers: allAnswers.slice(0, officialGabaritoTemplate.totalQuestions),
        pageNumber,
        rawText: text.substring(0, 200),
        confidence: overallConfidence,
      });
    }
  }

  return students;
}

// Async PDF processor function - 🔥 100% OMR ULTRA (SEM GPT)
async function processPdfJob(jobId: string, fileBuffer: Buffer, enableOcr: boolean = false, _enableChatGPT: boolean = false, template: string = "default", isImage: boolean = false) {
  const job = jobs.get(jobId);
  if (!job) return;

  try {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`[JOB ${jobId}] 🔥 INICIANDO OMR ULTRA`);
    console.log(`${"=".repeat(70)}`);
    console.log(`[JOB ${jobId}] 📋 Configurações:`);
    console.log(`[JOB ${jobId}]   - Tipo de arquivo: ${isImage ? '🖼️ IMAGEM' : '📄 PDF'}`);
    console.log(`[JOB ${jobId}]   - OCR Cabeçalho: 🤖 GPT Vision (mais preciso)`);
    console.log(`[JOB ${jobId}]   - OMR Bolhas: 🔥 OpenCV (rápido, sem custo)`);

    // PASSO 1: Verificar serviços
    console.log(`\n[JOB ${jobId}] ━━━ PASSO 1/5: VERIFICANDO SERVIÇOS ━━━`);

    let usePythonOMR = USE_PYTHON_OMR;
    const omrServiceUrl = USE_MODAL ? MODAL_OMR_HEALTH_URL : PYTHON_OMR_SERVICE_URL;
    if (usePythonOMR) {
      console.log(`[JOB ${jobId}] 🔍 Verificando Python OMR em ${omrServiceUrl} (Modal: ${USE_MODAL})...`);
      const pythonOMRAvailable = await checkPythonOMRService();
      if (!pythonOMRAvailable) {
        console.warn(`[JOB ${jobId}] ⚠️  Serviço Python OMR não está disponível em ${omrServiceUrl}`);
        console.warn(`[JOB ${jobId}] ${USE_MODAL ? 'Verifique o deploy do Modal' : 'Execute: cd python_omr_service && python app.py'}`);
        console.warn(`[JOB ${jobId}] Usando OMR TypeScript como fallback...`);
        usePythonOMR = false;
      } else {
        console.log(`[JOB ${jobId}] ✅ Python OMR disponível e pronto! (${USE_MODAL ? 'Modal' : 'Local'})`);
      }
    }

    // 🆕 Abordagem Híbrida: OpenCV (bolhas) + GPT Vision (header)
    if (enableOcr && process.env.OPENAI_API_KEY) {
      console.log(`[JOB ${jobId}] ✅ GPT Vision disponível para extração de header`);
    } else {
      console.warn(`[JOB ${jobId}] ⚠️ GPT Vision desativado (enableOcr=${enableOcr}, OPENAI_API_KEY=${process.env.OPENAI_API_KEY ? 'definida' : 'não definida'})`);
    }

    // PASSO 2: Carregar PDF ou processar imagem
    console.log(`\n[JOB ${jobId}] ━━━ PASSO 2/5: CARREGANDO ARQUIVO ━━━`);

    let pdfDoc: PDFDocument | null = null;
    let pageCount: number;
    let singleImageBuffer: Buffer | null = null;

    try {
      if (isImage) {
        // Se for imagem, contar como 1 página
        pageCount = 1;
        singleImageBuffer = fileBuffer;
        console.log(`[JOB ${jobId}] 🖼️ Imagem carregada (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
        job.totalPages = 1;
      } else {
        // Carregar PDF normalmente
        console.log(`[JOB ${jobId}] 📄 Carregando PDF (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)...`);
        pdfDoc = await PDFDocument.load(fileBuffer);
        pageCount = pdfDoc.getPageCount();

        if (pageCount === 0) {
          throw new Error("PDF não contém páginas ou está corrompido");
        }

        // Garantir que totalPages está definido (já deveria estar, mas garantir)
        if (job.totalPages === 0) {
          job.totalPages = pageCount;
        }

        console.log(`[JOB ${jobId}] 📄 PDF carregado com ${pageCount} página(s)`);
      }

      job.status = "processing";
    } catch (fileError) {
      console.error(`[JOB ${jobId}] Erro ao carregar arquivo:`, fileError);
      job.status = "error";
      job.errorMessage = fileError instanceof Error ? fileError.message : "Erro ao carregar o arquivo. Por favor, tente novamente.";
      return;
    }

    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    // Processar páginas em paralelo (4 com 4GB RAM disponível)
    const PARALLEL_PAGES = 4;
    const processPage = async (pageIndex: number) => {
      const pageNumber = pageIndex + 1;
      // Declarar variáveis no início da função para evitar "used before initialization"
      let studentName = `Aluno ${pageNumber}`;
      let studentNumber = `P${pageNumber.toString().padStart(3, "0")}`;

      try {
        let imageBuffer: Buffer;

        if (isImage) {
          // Se for imagem, usar direto
          imageBuffer = singleImageBuffer!;
          console.log(`[JOB ${jobId}] 🖼️ Usando imagem fornecida (página ${pageNumber})`);
        } else {
          // Se for PDF, extrair página
          const singlePageDoc = await PDFDocument.create();
          const [copiedPage] = await singlePageDoc.copyPages(pdfDoc!, [pageIndex]);
          singlePageDoc.addPage(copiedPage);
          const singlePagePdfBytes = await singlePageDoc.save();

          // Convert PDF to image
          // Usar timestamp + pageNumber + jobId para evitar conflitos em processamento paralelo
          const timestamp = Date.now();
          const uniqueId = `${jobId.slice(0, 8)}_${pageNumber}_${timestamp}`;
          const tempPdfPath = `/tmp/page_${uniqueId}.pdf`;
          const tempPngPath = `/tmp/page_${uniqueId}`;
          await fs.writeFile(tempPdfPath, singlePagePdfBytes);

          // Variável para rastrear extensão do arquivo gerado
          let outputExt = '.png';

          try {
            // DPI 200 + grayscale + JPEG = ~3x mais rápido que PNG 300dpi
            // Mantém qualidade suficiente para OMR (bolhas são grandes o suficiente)
            await execAsync(`pdftoppm -jpeg -gray -r 200 -jpegopt quality=90 -singlefile "${tempPdfPath}" "${tempPngPath}"`);
            outputExt = '.jpg';
          } catch {
            // Fallback: usar sharp com DPI 200 e grayscale
            const sharpImage = await sharp(Buffer.from(singlePagePdfBytes), { density: 200 })
              .grayscale()
              .jpeg({ quality: 90 })
              .toBuffer();
            await fs.writeFile(`${tempPngPath}.jpg`, sharpImage);
            outputExt = '.jpg';
          }

          imageBuffer = await fs.readFile(`${tempPngPath}${outputExt}`);

          // Cleanup temp files
          await fs.unlink(tempPdfPath).catch(() => { });
          await fs.unlink(`${tempPngPath}${outputExt}`).catch(() => { });
        }

        // PASSO 3: Processar OMR + QR Code
        console.log(`\n[JOB ${jobId}] ━━━ PASSO 3/5: OMR + QR CODE - PÁGINA ${pageNumber} ━━━`);

        let mergedAnswers: Array<string | null> = [];
        let scanQualityWarnings: string[] = [];
        let overallConfidence = 0.7;
        let studentTurma: string | undefined;

        if (usePythonOMR) {
          try {
            console.log(`[JOB ${jobId}] 🔵 Chamando Python OMR + QR para página ${pageNumber}...`);
            const startOMR = Date.now();

            // 🆕 Usar endpoint que lê QR Code + OMR
            const qrResult = await callPythonOMRWithQR(imageBuffer, pageNumber);
            const omrDuration = Date.now() - startOMR;

            if (qrResult.status === "sucesso" && qrResult.answers) {
              // Sucesso: QR lido + OMR processado
              mergedAnswers = qrResult.answers.map(a => a || null);
              const stats = qrResult.stats || { answered: 0, blank: 90, double_marked: 0 };

              console.log(`[JOB ${jobId}] ✅ QR+OMR: ${stats.answered}/90 respostas (${omrDuration}ms)`);

              // Extrair dados do aluno do QR Code
              if (qrResult.sheet_code) {
                studentNumber = qrResult.sheet_code;
                console.log(`[JOB ${jobId}] 📋 Sheet Code: ${qrResult.sheet_code}`);
              }

              if (qrResult.student) {
                if (qrResult.student.student_name) {
                  studentName = qrResult.student.student_name;
                  console.log(`[JOB ${jobId}] 👤 Nome: ${studentName}`);
                }
                if (qrResult.student.enrollment) {
                  studentNumber = qrResult.student.enrollment;
                  console.log(`[JOB ${jobId}] 🎫 Matrícula: ${studentNumber}`);
                }
                if (qrResult.student.class_name) {
                  studentTurma = qrResult.student.class_name;
                  console.log(`[JOB ${jobId}] 🏫 Turma: ${studentTurma}`);
                }
              }

              // Calcular confiança
              overallConfidence = stats.answered > 0 ? 0.70 + (stats.answered / 90) * 0.28 : 0.40;

            } else if (qrResult.code === "QR_NOT_FOUND") {
              // QR não encontrado - usar fallback para OMR simples
              console.warn(`[JOB ${jobId}] ⚠️ QR Code não encontrado, usando OMR simples...`);

              const omrConfig = template === "modelo_menor" ? "modelo_menor" : "default";
              const pythonResult = await callPythonOMRWithRetry(imageBuffer, pageNumber, omrConfig);
              const omrResultInternal = convertPythonOMRToInternal(pythonResult, officialGabaritoTemplate.totalQuestions);

              mergedAnswers = [...omrResultInternal.detectedAnswers];
              overallConfidence = omrResultInternal.overallConfidence;

              const detected = mergedAnswers.filter(a => a).length;
              console.log(`[JOB ${jobId}] ✅ OMR Fallback: ${detected}/90 respostas`);
              scanQualityWarnings.push("QR Code não detectado - aluno não identificado");

            } else {
              throw new Error(qrResult.message || "Erro desconhecido no serviço Python OMR");
            }
          } catch (pythonError) {
            console.error(`[JOB ${jobId}] ❌ Erro no Python OMR:`, pythonError);
            throw new Error(`Serviço Python OMR falhou. Verifique se está rodando em ${PYTHON_OMR_SERVICE_URL}`);
          }
        } else {
          throw new Error(`Serviço Python OMR não disponível. Execute: cd python_omr_service && python app.py`);
        }

        // PASSO 4: VALIDAÇÃO DAS RESPOSTAS
        console.log(`\n[JOB ${jobId}] ━━━ PASSO 4/5: VALIDAÇÃO (PÁGINA ${pageNumber}) ━━━`);

        const expectedLength = officialGabaritoTemplate.totalQuestions;
        const omrLength = mergedAnswers.length;

        console.log(`[JOB ${jobId}] 📊 RESULTADO:`);
        console.log(`[JOB ${jobId}]   - Esperado: ${expectedLength} questões`);
        console.log(`[JOB ${jobId}]   - Detectadas: ${omrLength} respostas`);
        console.log(`[JOB ${jobId}]   - Respondidas: ${mergedAnswers.filter(a => a).length}/90`);

        // Validar tamanho
        if (omrLength !== expectedLength) {
          const warningMsg = `OMR retornou ${omrLength} respostas, ajustando para ${expectedLength}.`;
          console.warn(`[JOB ${jobId}] ⚠️ ${warningMsg}`);
          while (mergedAnswers.length < expectedLength) {
            mergedAnswers.push(null);
          }
          mergedAnswers = mergedAnswers.slice(0, expectedLength);
        }

        // Log das primeiras 10 questões para debug
        const first10 = mergedAnswers.slice(0, 10).map((ans, idx) => `Q${idx + 1}="${ans || '-'}"`).join(", ");
        console.log(`[JOB ${jobId}] 📋 Primeiras 10: ${first10}`);

        console.log(`[JOB ${jobId}] ✅ Processamento concluído para página ${pageNumber}`);
        console.log(`[JOB ${jobId}] 🔥 Método: QR Code + OMR OpenCV`);

        // Converter respostas para formato final (string vazia para null)
        const finalAnswers = mergedAnswers.map(ans => ans ?? "");

        // AUDITORIA FINAL
        const finalAnswered = finalAnswers.filter(a => a !== "").length;
        console.log(`[JOB ${jobId}] ✅ finalAnswers: ${finalAnswered}/${officialGabaritoTemplate.totalQuestions} questões (página ${pageNumber})`);

        // Montar texto de qualidade
        const qualityInfo: string[] = [];
        if (scanQualityWarnings.length > 0) {
          qualityInfo.push(`⚠️ ${scanQualityWarnings.join(" | ")}`);
        }

        const student: StudentData = {
          id: randomUUID(),
          studentNumber,
          studentName,
          turma: studentTurma,
          answers: finalAnswers,
          pageNumber,
          confidence: Math.round(overallConfidence * 100),
          rawText: qualityInfo.length > 0 ? qualityInfo.join(" | ") : undefined,
        };

        // Retornar dados para o console do frontend
        return {
          student,
          warnings: scanQualityWarnings,
          pageResult: {
            detectedAnswers: mergedAnswers,
            overallConfidence,
          }
        };
      } catch (pageError) {
        const errorMsg = pageError instanceof Error ? pageError.message : String(pageError);
        console.error(`[JOB ${jobId}] ❌ ERRO DETALHADO página ${pageNumber}:`, errorMsg);
        console.error(`[JOB ${jobId}] Stack:`, pageError instanceof Error ? pageError.stack : 'N/A');
        return { student: null, warnings: [`Erro na página ${pageNumber}: ${errorMsg}`], pageResult: null };
      }
    };

    // Processar páginas em lotes paralelos
    // 🔧 Delay entre batches para gerenciamento de memória no servidor
    const BATCH_DELAY_MS = 500; // 500ms entre batches

    for (let batchStart = 0; batchStart < pageCount; batchStart += PARALLEL_PAGES) {
      const batchEnd = Math.min(batchStart + PARALLEL_PAGES, pageCount);
      const batch = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);
      const batchNumber = Math.floor(batchStart / PARALLEL_PAGES) + 1;

      // Mostrar início do batch
      console.log(`[JOB ${jobId}] Processando páginas ${batchStart + 1}-${batchEnd}/${pageCount} em paralelo (batch ${batchNumber})...`);

      // Processar lote em paralelo
      const results = await Promise.all(batch.map(processPage));

      // Adicionar resultados ao job e ATUALIZAR PROGRESSO APÓS CADA RESULTADO
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const pageNum = batchStart + i + 1;

        // Atualizar progresso APÓS processar cada página
        job.currentPage = pageNum;
        job.progress = Math.round((pageNum / pageCount) * 100);

        if (result.student) {
          job.students.push(result.student);
        }
        if (result.warnings.length > 0) {
          job.warnings.push(...result.warnings);
        }
        // Atualizar lastPageResult para o console do frontend
        if (result.pageResult) {
          job.lastPageResult = result.pageResult;
        }
      }

      // 🔧 Delay entre batches para evitar rate limiting (exceto no último)
      if (batchEnd < pageCount) {
        console.log(`[JOB ${jobId}] ⏳ Aguardando ${BATCH_DELAY_MS}ms antes do próximo batch...`);
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    // COMBINAR PÁGINAS DO MESMO ALUNO (para ENEM completo com 180 questões)
    // Se há 2 páginas e alunos com mesmo número de matrícula, combinar respostas
    if (pageCount === 2 && job.students.length === 2) {
      const [student1, student2] = job.students;

      // Verificar se são do mesmo aluno (mesmo número de matrícula ou nome similar)
      const sameStudent = student1.studentNumber === student2.studentNumber ||
        (student1.studentName && student2.studentName &&
          student1.studentName.toLowerCase().trim() === student2.studentName.toLowerCase().trim());

      if (sameStudent && student1.answers.length === 90 && student2.answers.length === 90) {
        console.log(`[JOB ${jobId}] 🔗 Combinando respostas de 2 páginas do mesmo aluno: ${student1.studentNumber || student1.studentName}`);
        console.log(`[JOB ${jobId}]   - Página 1: ${student1.answers.filter(a => a && a !== "").length} respostas (Q1-90)`);
        console.log(`[JOB ${jobId}]   - Página 2: ${student2.answers.filter(a => a && a !== "").length} respostas (será mapeado para Q91-180)`);

        // Combinar respostas: página 1 (Q1-90) + página 2 (Q91-180)
        const combinedAnswers = [...student1.answers, ...student2.answers];
        const combinedAiAnswers = student1.aiAnswers && student2.aiAnswers
          ? [...student1.aiAnswers, ...student2.aiAnswers]
          : undefined;

        // Usar dados do primeiro aluno como base
        const combinedStudent: StudentData = {
          ...student1,
          answers: combinedAnswers,
          aiAnswers: combinedAiAnswers,
          // Manter informações de ambas as páginas no rawText
          rawText: `Página 1: ${student1.rawText || 'OK'} | Página 2: ${student2.rawText || 'OK'}`,
        };

        // Substituir os 2 alunos separados por 1 aluno combinado
        job.students = [combinedStudent];

        console.log(`[JOB ${jobId}] ✅ Aluno combinado: ${combinedAnswers.filter(a => a && a !== "").length}/180 questões respondidas`);
      }
    }

    job.status = "completed";
    job.progress = 100;
    console.log(`[JOB ${jobId}] Concluído! ${job.students.length} aluno(s) processado(s).`);
  } catch (error) {
    console.error(`[JOB ${jobId}] Erro:`, error);
    job.status = "error";
    job.errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
  } finally {
    // DeepSeek-OCR não precisa de cleanup (é um serviço externo)
    console.log(`[JOB ${jobId}] Processamento finalizado`);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Registrar rotas de debug
  registerDebugRoutes(app);

  // Start PDF processing - returns jobId immediately
  // PROTEGIDO: Apenas super_admin pode processar PDFs (funcionalidade ENEM/XTRI)
  app.post("/api/process-pdf", requireAuth, requireRole('super_admin'), upload.single("pdf"), async (req: Request, res: Response) => {
    try {
      console.log("[UPLOAD] Recebendo arquivo...");

      if (!req.file) {
        res.status(400).json({ error: "Nenhum arquivo enviado" });
        return;
      }

      console.log(`[UPLOAD] Arquivo: ${req.file.originalname}, Tipo: ${req.file.mimetype}, ${(req.file.size / 1024 / 1024).toFixed(2)}MB`);

      // Check if OCR is enabled (from form field)
      const enableOcr = req.body?.enableOcr === 'true' || req.body?.enableOcr === true;
      // Template/config do gabarito (padrão: "default", alternativa: "modelo_menor")
      const template = req.body?.template || req.body?.config || "default";
      // GPT desabilitado - apenas OMR Ultra
      const enableChatGPT = false;

      // Create job
      const jobId = randomUUID();

      // Verificar se é imagem ou PDF
      const isImage = req.file.mimetype.startsWith("image/");
      let initialPageCount = 0;

      if (isImage) {
        // Se for imagem, contar como 1 página
        initialPageCount = 1;
        console.log("[IMAGE] Imagem detectada, processando como 1 página");
      } else {
        // Tentar carregar PDF para obter pageCount imediatamente
        try {
          const pdfDoc = await PDFDocument.load(req.file.buffer);
          initialPageCount = pdfDoc.getPageCount();
          if (initialPageCount === 0) {
            res.status(400).json({ error: "PDF não contém páginas ou está corrompido" });
            return;
          }
          console.log(`[PDF] PDF carregado com ${initialPageCount} páginas`);
        } catch (pdfError) {
          console.error("[PDF] Erro ao carregar PDF:", pdfError);
          res.status(400).json({
            error: pdfError instanceof Error ? pdfError.message : "Erro ao carregar o PDF. Por favor, tente novamente."
          });
          return;
        }
      }

      const job: ProcessingJob = {
        id: jobId,
        status: "queued",
        progress: 0,
        currentPage: 0,
        totalPages: initialPageCount,
        students: [],
        warnings: [],
        createdAt: new Date(),
      };
      jobs.set(jobId, job);

      // Start processing in background
      const fileBuffer = req.file.buffer;
      setImmediate(() => processPdfJob(jobId, fileBuffer, enableOcr, enableChatGPT, template, isImage));

      // Return immediately
      res.json({ jobId, message: "Processamento iniciado" });
    } catch (error) {
      console.error("Upload Error:", error);
      res.status(500).json({ error: "Erro ao iniciar processamento" });
    }
  });

  // Endpoint de debug - Testa OMR Ultra
  // PROTEGIDO: Apenas super_admin pode testar OMR
  app.post("/api/debug-omr", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
    try {
      console.log("🔧 DEBUG OMR Ultra: Iniciando teste...");

      // Verificar se OMR Ultra está disponível
      const omrAvailable = await checkPythonOMRService();
      if (!omrAvailable) {
        res.status(500).json({
          error: "OMR Ultra não disponível",
          help: "Execute: cd python_omr_service && python3 app_ultra.py"
        });
        return;
      }

      res.json({
        success: true,
        message: "🔥 OMR Ultra está funcionando!",
        service: PYTHON_OMR_SERVICE_URL
      });

    } catch (error: any) {
      console.log("❌ DEBUG: Erro:", error.message);
      res.status(500).json({ error: "Erro interno", details: error.message });
    }
  });

  // Get job status for polling
  // PROTEGIDO: Apenas usuários autenticados podem verificar status
  app.get("/api/process-pdf/:jobId/status", requireAuth, (req: Request, res: Response) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }

    res.json({
      status: job.status,
      progress: job.progress,
      currentPage: job.currentPage,
      totalPages: job.totalPages,
      studentCount: job.students.length,
      errorMessage: job.errorMessage,
      // Dados adicionais para o console do frontend
      lastPageResult: job.lastPageResult,
    });
  });

  // Get job results
  // PROTEGIDO: Apenas usuários autenticados podem ver resultados
  app.get("/api/process-pdf/:jobId/results", requireAuth, (req: Request, res: Response) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }

    res.json({
      status: job.status,
      students: job.students,
      totalPages: job.totalPages,
      warnings: job.warnings,
    });
  });

  // PROTEGIDO: Exportação de Excel requer autenticação
  app.post("/api/export-excel", requireAuth, async (req: Request, res: Response) => {
    try {
      const { students, answerKey, questionContents, statistics, includeTRI, triScores, triScoresByArea } = req.body as {
        students: StudentData[];
        answerKey?: string[];
        questionContents?: Array<{ questionNumber: number; answer: string; content: string }>;
        statistics?: ExamStatistics;
        includeTRI?: boolean;
        triScores?: Record<string, number>; // Convertido de Map para objeto
        triScoresByArea?: Record<string, Record<string, number>>; // Convertido de Map para objeto
      };

      if (!students || !Array.isArray(students)) {
        res.status(400).json({ error: "Nenhum dado de aluno fornecido" });
        return;
      }

      // Converter objetos de volta para Maps se necessário
      const triScoresMap = triScores ? new Map(Object.entries(triScores)) : undefined;
      const triScoresByAreaMap = triScoresByArea ? new Map(Object.entries(triScoresByArea)) : undefined;

      // Usar ExcelExporter com formatação rica
      const excelBuffer = await ExcelExporter.generateExcel({
        students,
        answerKey,
        questionContents,
        statistics,
        includeTRI,
        triScores: triScoresMap,
        triScoresByArea: triScoresByAreaMap,
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="gabarito_enem_${new Date().toISOString().split("T")[0]}.xlsx"`
      );
      res.send(excelBuffer);
    } catch (error) {
      console.error("Excel Export Error:", error);
      res.status(500).json({
        error: "Erro ao exportar Excel",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  // Download project as ZIP
  app.get("/api/download-project-zip", async (req: Request, res: Response) => {
    try {
      console.log("[DOWNLOAD-ZIP] Iniciando criação do ZIP do projeto...");

      const projectRoot = process.cwd();
      const zipFileName = `gabaritosxtri_${new Date().toISOString().split("T")[0]}.zip`;

      // Set headers for file download
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${zipFileName}"`
      );

      // Create archiver
      const archive = archiver("zip", {
        zlib: { level: 9 }, // Maximum compression
      });

      // Pipe archive data to response
      archive.pipe(res);

      // Files and directories to include
      const includePaths = [
        "client",
        "server",
        "shared",
        "script",
        "attached_assets",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "vite.config.ts",
        "tailwind.config.ts",
        "drizzle.config.ts",
        "postcss.config.js",
        "components.json",
        "README.md",
        "design_guidelines.md",
        "replit.md",
        ".gitignore",
      ];

      // Files and directories to exclude
      const excludePatterns = [
        "node_modules",
        ".git",
        "dist",
        ".DS_Store",
        "*.log",
        ".local",
        "*.zip",
      ];

      // Helper function to check if path should be excluded
      const shouldExclude = (filePath: string): boolean => {
        return excludePatterns.some((pattern) => {
          if (pattern.includes("*")) {
            const regex = new RegExp(pattern.replace("*", ".*"));
            return regex.test(filePath);
          }
          return filePath.includes(pattern);
        });
      };

      // Helper function to add directory recursively
      const addDirectory = async (dirPath: string, zipPath: string) => {
        try {
          const entries = await fs.readdir(dirPath, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const relativePath = path.relative(projectRoot, fullPath);
            const zipEntryPath = path.join(zipPath, entry.name);

            // Skip excluded paths
            if (shouldExclude(relativePath)) {
              continue;
            }

            if (entry.isDirectory()) {
              await addDirectory(fullPath, zipEntryPath);
            } else if (entry.isFile()) {
              archive.file(fullPath, { name: zipEntryPath });
            }
          }
        } catch (error) {
          console.warn(`[DOWNLOAD-ZIP] Erro ao adicionar diretório ${dirPath}:`, error);
        }
      };

      // Add files and directories
      for (const includePath of includePaths) {
        const fullPath = path.join(projectRoot, includePath);

        try {
          const stat = await fs.stat(fullPath);

          if (stat.isDirectory()) {
            await addDirectory(fullPath, includePath);
          } else if (stat.isFile()) {
            archive.file(fullPath, { name: includePath });
          }
        } catch (error) {
          console.warn(`[DOWNLOAD-ZIP] Arquivo/diretório não encontrado: ${includePath}`);
        }
      }

      // Finalize the archive
      await archive.finalize();

      console.log(`[DOWNLOAD-ZIP] ZIP criado com sucesso: ${zipFileName}`);
    } catch (error) {
      console.error("[DOWNLOAD-ZIP] Erro ao criar ZIP:", error);
      if (!res.headersSent) {
        res.status(500).json({
          error: "Erro ao criar arquivo ZIP",
          details: error instanceof Error ? error.message : "Erro desconhecido",
        });
      }
    }
  });

  app.get("/api/health", (req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ⚠️ ENDPOINT TEMPORÁRIO - Promover xandao@gmail.com para super_admin
  // REMOVER APÓS USO!
  app.get("/api/fix-admin-xandao", async (req: Request, res: Response) => {
    try {
      const targetEmail = "xandao@gmail.com";

      // Buscar profile pelo email
      const { data: profile, error: fetchError } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("email", targetEmail)
        .single();

      if (fetchError || !profile) {
        // Se não existe profile, buscar usuário auth e criar profile
        const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
        const authUser = authUsers?.users?.find(u => u.email === targetEmail);

        if (!authUser) {
          return res.status(404).json({
            error: "Usuário não encontrado no Auth nem no Profiles",
            email: targetEmail
          });
        }

        // Criar profile para o usuário auth existente
        const { error: createError } = await supabaseAdmin
          .from("profiles")
          .insert({
            id: authUser.id,
            email: targetEmail,
            name: "Admin XTRI",
            role: "super_admin"
          });

        if (createError) {
          return res.status(500).json({ error: createError.message });
        }

        return res.json({
          success: true,
          action: "created",
          message: "Profile criado como super_admin",
          userId: authUser.id
        });
      }

      // Atualizar role para super_admin
      const { error: updateError } = await supabaseAdmin
        .from("profiles")
        .update({ role: "super_admin" })
        .eq("email", targetEmail);

      if (updateError) {
        return res.status(500).json({ error: updateError.message });
      }

      res.json({
        success: true,
        action: "updated",
        message: "Role atualizada para super_admin",
        user: {
          id: profile.id,
          email: profile.email,
          oldRole: profile.role,
          newRole: "super_admin"
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Endpoint TRI V2 - Status/Info (GET)
  app.get("/api/calculate-tri-v2", async (req: Request, res: Response) => {
    try {
      const triAvailable = await checkPythonTRIService();
      res.json({
        endpoint: "POST /api/calculate-tri-v2",
        description: "Cálculo TRI V2 com Coerência Pedagógica",
        service_status: triAvailable ? "online" : "offline",
        service_url: PYTHON_TRI_SERVICE_URL,
        version: "2.0.0",
        algorithm: "Coerência Pedagógica com Análise Estatística",
        usage: {
          method: "POST",
          body: {
            alunos: "[{nome: string, q1: string, q2: string, ...}]",
            gabarito: "{1: 'A', 2: 'B', ...}",
            areas_config: "{CH: [1, 45], CN: [46, 90], ...} (opcional)"
          },
          example: `curl -X POST ${PYTHON_TRI_SERVICE_URL}/api/calcular-tri -H "Content-Type: application/json" -d '{"alunos": [...], "gabarito": {...}}'`
        },
        features: [
          "Análise de coerência pedagógica",
          "Detecção de padrão inverso (acerta difíceis, erra fáceis)",
          "Ajustes por concordância prova-aluno",
          "Penalidades por inconsistência (-60 pts)",
          "Range TRI: 300-900 pontos"
        ]
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Endpoint TRI V2 - Coerência Pedagógica (Python Service)
  app.post("/api/calculate-tri-v2", async (req: Request, res: Response) => {
    try {
      const { alunos, gabarito, areas_config } = req.body;

      // Validar entrada
      if (!alunos || !Array.isArray(alunos) || alunos.length === 0) {
        res.status(400).json({ error: "Lista de alunos vazia ou inválida" });
        return;
      }

      if (!gabarito || typeof gabarito !== 'object') {
        res.status(400).json({ error: "Gabarito não fornecido ou inválido" });
        return;
      }

      // Verificar se serviço Python TRI está online
      const triAvailable = await checkPythonTRIService();
      if (!triAvailable) {
        res.status(503).json({
          error: "Serviço TRI offline",
          details: `O serviço Python TRI não está respondendo em ${PYTHON_TRI_SERVICE_URL}`
        });
        return;
      }

      // Chamar serviço Python TRI V2
      console.log(`[TRI V2] Chamando serviço Python com ${alunos.length} alunos...`);
      const resultado = await callPythonTRI(alunos, gabarito, areas_config);

      console.log(`[TRI V2] Sucesso: ${resultado.total_alunos} alunos processados`);
      res.json(resultado);

    } catch (error: any) {
      console.error("[TRI V2] Erro ao calcular TRI V2:", error);
      res.status(500).json({
        error: "Erro ao calcular TRI V2",
        details: error.message || "Erro desconhecido",
        stack: error.stack
      });
    }
  });

  // Endpoint to get TRI estimate with coherence (Two-Pass Algorithm)
  // ATUALIZADO: Usar serviço Python V2 quando disponível
  app.post("/api/calculate-tri", async (req: Request, res: Response) => {
    try {
      const { students, area, ano, questionStats, answerKey, startQuestion, endQuestion } = req.body as {
        students: StudentData[];
        area: string; // CH, CN, MT, LC, etc
        ano: number; // Ano da prova
        questionStats?: Array<{ questionNumber: number; correctPercentage: number }>; // Estatísticas das questões (opcional, será calculado se não fornecido)
        answerKey?: string[]; // Gabarito para verificar acertos
        startQuestion?: number; // Questão inicial (1-indexed, para áreas específicas)
        endQuestion?: number; // Questão final (1-indexed, para áreas específicas)
      };

      if (!students || !Array.isArray(students) || students.length === 0) {
        res.status(400).json({ error: "Lista de alunos vazia" });
        return;
      }

      if (!area || !ano) {
        res.status(400).json({ error: "Área e ano são obrigatórios" });
        return;
      }

      if (!answerKey || answerKey.length === 0) {
        res.status(400).json({ error: "Gabarito não fornecido" });
        return;
      }

      // =====================================================
      // VALIDAÇÕES DE SEGURANÇA - EVITAR CÁLCULOS INCORRETOS
      // =====================================================
      const start = startQuestion || 1;
      const end = endQuestion || answerKey.length;
      const expectedQuestions = end - start + 1;

      // Validar que o gabarito tem o tamanho correto
      if (answerKey.length !== expectedQuestions && answerKey.length !== 45) {
        console.warn(`[TRI] ⚠️ Gabarito com ${answerKey.length} questões, esperado ${expectedQuestions} ou 45`);
      }

      // Verificar se as respostas já vieram fatiadas do frontend
      const primeiroAluno = students[0];
      if (primeiroAluno && primeiroAluno.answers) {
        const jaFatiado = primeiroAluno.answers.length === answerKey.length;
        if (jaFatiado) {
          console.log(`[TRI] ✅ Respostas já fatiadas pelo frontend: ${primeiroAluno.answers.length} respostas = ${answerKey.length} gabarito`);
        } else {
          const temRespostasParaArea = primeiroAluno.answers.length >= end;
          if (!temRespostasParaArea) {
            console.warn(`[TRI] ⚠️ Aluno tem ${primeiroAluno.answers.length} respostas, área ${area} precisa ${end - start + 1} (${start}-${end})`);
          }
        }
      }

      console.log(`[TRI] 📊 Calculando TRI para área ${area}: questões ${start}-${end}, gabarito com ${answerKey.length} itens`);

      // TENTAR USAR SERVIÇO PYTHON V2 PRIMEIRO
      const triV2Available = await checkPythonTRIService();

      if (triV2Available && USE_PYTHON_TRI) {
        console.log(`[TRI] Usando serviço Python V2 para área ${area}...`);

        try {
          // Preparar dados para o serviço Python V2
          // IMPORTANTE: O frontend JÁ ENVIA as respostas FATIADAS (45 questões por área)
          // Então NÃO devemos fatiar novamente aqui!
          // As respostas já estão como [0-44] para qualquer área.

          const alunosParaPython = students.map(student => {
            const studentAnswers = student.answers || [];

            // O frontend já enviou as respostas fatiadas para esta área
            // Então usamos diretamente, sem fatiar novamente
            // Se o aluno tem exatamente 45 respostas (ou igual ao gabarito), já está fatiado
            const jaFatiado = studentAnswers.length === answerKey.length;
            const answersToUse = jaFatiado ? studentAnswers : studentAnswers.slice(start - 1, end);

            // Calcular acertos desta área para apoiar coerência pedagógica
            let acertosArea = 0;
            answersToUse.forEach((ans, idx) => {
              const key = answerKey[idx];
              if (ans && key && String(ans).trim().toUpperCase() === String(key).trim().toUpperCase()) {
                acertosArea++;
              }
            });

            // Converter array para formato Python: {q1: "A", q2: "B", ...}
            const respostasObj: Record<string, string> = {};
            answersToUse.forEach((answer, idx) => {
              const questionNum = idx + 1; // Sempre 1, 2, 3... para o Python
              respostasObj[`q${questionNum}`] = answer ? String(answer).toUpperCase().trim() : "";
            });

            // 🔎 Log fino por aluno (primeiro apenas) para auditoria
            // Mostra acertos calculados aqui e primeira/última questão dessa área
            const first = answersToUse[0] ?? "";
            const last = answersToUse[answersToUse.length - 1] ?? "";
            console.log(`[TRI][PY-REQ][ALUNO] area=${area} id=${student.id} acertos_calc=${acertosArea} q1=${first} q${answersToUse.length}=${last}`);

            return {
              id: student.id,
              nome: student.studentName || student.studentNumber || student.id,
              acertos: acertosArea, // apoio para coerência e logs
              ...respostasObj // Espalhar as respostas q1, q2, q3...
            };
          });

          // Converter gabarito para formato Python: {1: "A", 2: "B", ...}
          // O gabarito já vem fatiado do frontend, então usar índices 1-45
          const gabaritoObj: Record<string, string> = {};
          answerKey.forEach((answer, idx) => {
            gabaritoObj[String(idx + 1)] = answer ? String(answer).toUpperCase().trim() : "";
          });

          // Log de payload (amostra) para auditar entrada do Python
          const aluno0 = alunosParaPython[0] as Record<string, unknown>;
          if (aluno0) {
            const q1 = (aluno0['q1'] as string) || "";
            const q2 = (aluno0['q2'] as string) || "";
            const q3 = (aluno0['q3'] as string) || "";
            const q4 = (aluno0['q4'] as string) || "";
            const q5 = (aluno0['q5'] as string) || "";
            console.log(`[TRI][PY-REQ] Área ${area} (amostra envio): id=${aluno0.id || aluno0.nome} ` +
              `q1..q5=${q1},${q2},${q3},${q4},${q5} | g1..g5=${gabaritoObj['1']},${gabaritoObj['2']},${gabaritoObj['3']},${gabaritoObj['4']},${gabaritoObj['5']} | acertos=${aluno0.acertos ?? '-'}`);
          }

          // Configurar áreas baseado na área sendo calculada
          // Para cálculo individual de área, usar apenas questões 1 até tamanho do gabarito
          const areasConfig: Record<string, [number, number]> = {};
          areasConfig[area] = [1, answerKey.length]; // Área atual usa todo o gabarito passado

          // =====================================================
          // VALIDAÇÃO DE SEGURANÇA - NUNCA ENVIAR DADOS INCORRETOS
          // =====================================================
          const primeiroAluno = alunosParaPython[0];
          const qtdRespostasAluno = Object.keys(primeiroAluno).filter(k => k.startsWith('q')).length;
          const qtdGabarito = Object.keys(gabaritoObj).length;

          if (qtdRespostasAluno !== qtdGabarito) {
            console.error(`[TRI] ❌ ERRO CRÍTICO: Quantidade de respostas (${qtdRespostasAluno}) não corresponde ao gabarito (${qtdGabarito})!`);
            console.error(`[TRI] ❌ Área: ${area}, Start: ${start}, End: ${end}`);
            throw new Error(`Inconsistência de dados: ${qtdRespostasAluno} respostas vs ${qtdGabarito} no gabarito`);
          }

          // Log de verificação (apenas primeiro aluno para não poluir)
          console.log(`[TRI] ✅ Validação OK: ${qtdRespostasAluno} respostas = ${qtdGabarito} gabarito`);
          console.log(`[TRI] 📤 Enviando ${alunosParaPython.length} alunos para Python V2, área ${area}, questões ${start}-${end} (${answerKey.length} questões)`);

          // Debug: Mostrar amostra das primeiras 3 questões para verificação
          const alunoAny = primeiroAluno as any;
          const amostraRespostas = [alunoAny.q1, alunoAny.q2, alunoAny.q3].join(',');
          const amostraGabarito = [gabaritoObj['1'], gabaritoObj['2'], gabaritoObj['3']].join(',');
          console.log(`[TRI] 📋 Amostra aluno 1: ${amostraRespostas} | Gabarito: ${amostraGabarito}`);

          // Chamar serviço Python TRI V2
          const pythonResponse = await callPythonTRI(
            alunosParaPython,
            gabaritoObj,
            areasConfig
          );

          if (pythonResponse && pythonResponse.resultados) {
            console.log(`[TRI] Python V2 retornou ${pythonResponse.resultados.length} resultados para área ${area}`);
            // Log seguro de amostra para auditoria
            const sample = pythonResponse.resultados[0];
            if (sample) {
              const triGeral = sample.tri_geral ?? sample.tri ?? sample.triScore ?? '-';
              const triLc = sample.tri_lc ?? sample.tri_linguagens ?? '-';
              const triCh = sample.tri_ch ?? sample.tri_humanas ?? '-';
              const triCn = sample.tri_cn ?? sample.tri_natureza ?? '-';
              const triMt = sample.tri_mt ?? sample.tri_matematica ?? '-';
              const acLc = sample.lc_acertos ?? sample.acertos_lc ?? '-';
              const acCh = sample.ch_acertos ?? sample.acertos_ch ?? '-';
              const acCn = sample.cn_acertos ?? sample.acertos_cn ?? '-';
              const acMt = sample.mt_acertos ?? sample.acertos_mt ?? '-';
              console.log(
                `[TRI][PY-RESP] Área ${area} (amostra): id=${sample.id || sample.nome || '??'} ` +
                `triG=${triGeral} | triLC=${triLc} triCH=${triCh} triCN=${triCn} triMT=${triMt} ` +
                `acertos LC=${acLc} CH=${acCh} CN=${acCn} MT=${acMt}`
              );
            }

            // Mapear resultados do Python para o formato esperado
            const results = pythonResponse.resultados.map((r: any) => {
              // Encontrar o aluno correspondente
              const aluno = alunosParaPython.find(a => a.id === r.id || a.nome === r.nome);

              // Pegar a TRI específica da área
              const triAreaKey = `tri_${area.toLowerCase()}`;
              const triScore = r[triAreaKey] || r.tri_geral || 0;

              return {
                studentId: aluno?.id || r.id || r.nome,
                triScore: triScore,
                correctAnswers: r[`${area.toLowerCase()}_acertos`] || 0,
                usarCoerencia: true
              };
            });
            // Validação: se todos vieram com triScore idêntico E acertos=0, considerar resultado inválido e usar fallback TS
            const allSameTri = results.length > 0 && results.every(r => r.triScore === results[0].triScore);
            const allZeroAcertos = results.every(r => !r.correctAnswers || r.correctAnswers === 0);
            if (allSameTri && allZeroAcertos) {
              console.warn(`[TRI] ⚠️ Python V2 retornou todos iguais (tri=${results[0].triScore}) e acertos=0 para área ${area}. Usando fallback TypeScript para esta área.`);
            } else {
              res.json({ results, usarCoerencia: true, source: "python_v2" });
              return;
            }
          }
        } catch (pythonError) {
          console.error(`[TRI] Erro ao usar Python V2, fallback para TypeScript:`, pythonError);
        }
      }

      // FALLBACK: Usar calculador TypeScript local
      console.log(`[TRI] Usando calculador TypeScript local para área ${area}...`);

      // Two-Pass Algorithm:
      // PASSO 1: Se questionStats não foi fornecido, calcular estatísticas da prova
      let finalQuestionStats = questionStats;
      if (!finalQuestionStats || finalQuestionStats.length === 0) {
        console.log("[TRI BACKEND] PASSO 1: Calculando estatísticas da prova...");

        const start = startQuestion || 1;
        const end = endQuestion || answerKey.length;

        finalQuestionStats = QuestionStatsProcessor.calculateQuestionStats(
          students,
          answerKey,
          start,
          end
        );

        // Se foi especificado um range, ajustar questionNumber para ser relativo
        if (startQuestion && endQuestion) {
          finalQuestionStats = finalQuestionStats.map(stat => ({
            questionNumber: stat.questionNumber - startQuestion + 1,
            correctPercentage: stat.correctPercentage,
          }));
        }
      }

      // PASSO 2: Calcular TRI individual usando as estatísticas
      console.log("[TRI BACKEND] PASSO 2: Calculando TRI individual para cada aluno...");

      // Se foi especificado um range, usar apenas as respostas e gabarito daquela área
      let studentsForCalculation = students;
      let answerKeyForCalculation = answerKey;

      if (startQuestion && endQuestion) {
        studentsForCalculation = students.map(student => ({
          ...student,
          answers: student.answers.slice(startQuestion - 1, endQuestion),
        }));
        answerKeyForCalculation = answerKey.slice(startQuestion - 1, endQuestion);
      }

      const { results, usarCoerencia } = await TRICalculator.calculate(
        studentsForCalculation,
        area,
        ano,
        finalQuestionStats,
        answerKeyForCalculation
      );

      // Ajustar studentId para corresponder aos IDs originais
      const adjustedResults = results.map((result, index) => ({
        ...result,
        studentId: students[index].id,
      }));

      const validResults = adjustedResults.filter(r => r.triScore !== null && r.triScore !== undefined);
      console.log(`[TRI BACKEND] Resultados finais: ${validResults.length} válidos de ${adjustedResults.length} total`);
      if (validResults.length === 0) {
        console.error(`[TRI BACKEND] NENHUM RESULTADO VÁLIDO! Verifique se o CSV tem dados para área ${area}`);
      }

      res.json({ results: adjustedResults, usarCoerencia });
    } catch (error) {
      console.error("[TRI BACKEND] Erro ao calcular TRI:", error);
      res.status(500).json({
        error: "Erro ao calcular notas TRI",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  // Análise pedagógica com IA
  app.post("/api/analyze-performance", async (req: Request, res: Response) => {
    try {
      const { students, triScores, triScoresByArea } = req.body;

      if (!students || !triScores) {
        res.status(400).json({ error: "Dados incompletos" });
        return;
      }

      // Calcular estatísticas básicas
      const triValues = Object.values(triScores) as number[];
      const avgTRI = triValues.reduce((a, b) => a + b, 0) / triValues.length;

      // Agrupar alunos por desempenho
      const grupos = {
        reforco: triValues.filter(t => t < 400).length,
        direcionado: triValues.filter(t => t >= 400 && t < 550).length,
        aprofundamento: triValues.filter(t => t >= 550).length,
      };

      // Análise por área
      const areaAnalysis: Record<string, any> = {};
      if (triScoresByArea) {
        const areas = ['LC', 'CH', 'CN', 'MT'];
        const areaNames: Record<string, string> = {
          'LC': 'Linguagens e Códigos',
          'CH': 'Ciências Humanas',
          'CN': 'Ciências da Natureza',
          'MT': 'Matemática'
        };

        for (const area of areas) {
          const scoresForArea = Object.values(triScoresByArea)
            .map((scores: any) => scores[area])
            .filter((score): score is number => typeof score === 'number' && score > 0);

          if (scoresForArea.length > 0) {
            const areaAvg = scoresForArea.reduce((a, b) => a + b, 0) / scoresForArea.length;
            const diff = areaAvg - avgTRI;
            areaAnalysis[area] = {
              name: areaNames[area],
              average: Math.round(areaAvg),
              diff: Math.round(diff),
              status: diff < -20 ? 'critical' : diff < 0 ? 'warning' : 'good',
              count: scoresForArea.length
            };
          }
        }
      }

      // Identificar alunos por faixa de desempenho para análise detalhada
      const studentsByPerformance = students.map((s: any) => ({
        name: s.studentName || s.studentNumber,
        tri: triScores[s.id],
        areas: triScoresByArea?.[s.id] || {}
      })).sort((a: { name: string; tri: number; areas: Record<string, number> }, b: { name: string; tri: number; areas: Record<string, number> }) => (a.tri || 0) - (b.tri || 0));

      const top3 = studentsByPerformance.slice(-3).reverse();
      const bottom3 = studentsByPerformance.slice(0, 3);

      // NOVA ANÁLISE GRANULAR: Habilidades no range de TRI da turma
      let analiseHabilidades = '';
      try {
        const { getHabilidadesPorTRI } = await import('./conteudosLoader.js');
        analiseHabilidades = getHabilidadesPorTRI(Math.round(avgTRI), 10);
        console.log('[AI Analysis] Análise de habilidades gerada com sucesso');
      } catch (error) {
        console.error('[AI Analysis] Erro ao gerar análise de habilidades:', error);
        analiseHabilidades = '\n⚠️ Não foi possível carregar dados de conteúdos ENEM.\n';
      }

      // Construir prompt para ChatGPT
      const prompt = `Você é um coordenador pedagógico especialista em ENEM e TRI. Analise esta turma e forneça um relatório EXECUTIVO e ACIONÁVEL:

📊 CONTEXTO DA TURMA:
- Total: ${students.length} alunos
- TRI médio geral: ${Math.round(avgTRI)} (meta ENEM: 500+)
- Distribuição:
  * ${grupos.reforco} alunos em RISCO (TRI < 400) - precisam reforço URGENTE
  * ${grupos.direcionado} alunos em DESENVOLVIMENTO (TRI 400-550) - próximos da meta
  * ${grupos.aprofundamento} alunos ACIMA da meta (TRI > 550) - podem ser monitores

📈 DESEMPENHO POR ÁREA (Comparativo com média da turma):
${Object.entries(areaAnalysis).map(([code, data]: [string, any]) => {
        const status = data.diff < -20 ? '🔴 CRÍTICO' : data.diff < 0 ? '🟡 ATENÇÃO' : '🟢 BOM';
        return `- ${data.name}: ${data.average} pontos (${data.diff >= 0 ? '+' : ''}${data.diff} pts) ${status}`;
      }).join('\n')}
${analiseHabilidades}

👥 DESTAQUES INDIVIDUAIS:
Melhores desempenhos:
${top3.map((s: { name: string; tri: number; areas: Record<string, number> }, i: number) => `${i + 1}. ${s.name}: ${Math.round(s.tri)} (LC:${Math.round(s.areas.LC || 0)} CH:${Math.round(s.areas.CH || 0)} CN:${Math.round(s.areas.CN || 0)} MT:${Math.round(s.areas.MT || 0)})`).join('\n')}

Precisam atenção urgente:
${bottom3.map((s: { name: string; tri: number; areas: Record<string, number> }, i: number) => `${i + 1}. ${s.name}: ${Math.round(s.tri)} (LC:${Math.round(s.areas.LC || 0)} CH:${Math.round(s.areas.CH || 0)} CN:${Math.round(s.areas.CN || 0)} MT:${Math.round(s.areas.MT || 0)})`).join('\n')}

🎯 FORNEÇA ANÁLISE ESTRUTURADA:

**ATENÇÃO**: Use as habilidades listadas acima (no range de TRI ${Math.round(avgTRI)}) para suas recomendações!
Cada área tem 10 habilidades prioritárias que a turma DEVERIA dominar nesse nível.

## 1. DIAGNÓSTICO (2-3 frases diretas)
- Qual a maior fraqueza da turma?
- Quais áreas comprometem mais o TRI geral?
- O que separa os alunos de risco dos que estão próximos da meta?

## 2. AÇÕES IMEDIATAS (próximas 2 semanas)
Liste 3-4 ações CONCRETAS que podem ser implementadas JÁ:
- **CITE AS HABILIDADES ESPECÍFICAS** (ex: H5, H12) que estão no range de TRI da turma
- Exemplo: "Plantão focado em Linguagens H1 e H10 (interpretação e gêneros textuais) - 2x/semana, terças 14h"
- Seja específico sobre QUEM faz, O QUE faz (qual habilidade), e QUANDO faz

## 3. ESTRATÉGIA POR GRUPO
- **${grupos.reforco} alunos em RISCO**: Quais das habilidades listadas devem ser priorizadas?
- **${grupos.direcionado} alunos em DESENVOLVIMENTO**: Como acelerar usando as habilidades do range?
- **${grupos.aprofundamento} alunos ACIMA da meta**: Como usar esse grupo a favor da turma?

## 4. META REALISTA (6 semanas)
- Quantos alunos podem sair da faixa de RISCO?
- Qual TRI médio esperado por área (LC/CH/CN/MT)?
- Qual o ganho de pontos mais realista considerando o tempo?

IMPORTANTE: 
- **USE AS HABILIDADES LISTADAS** - não invente habilidades genéricas
- SEJA CIRÚRGICO: cite códigos de habilidades (H1, H5, etc), números, áreas específicas
- Mencione pelo menos 3-4 habilidades específicas nas suas recomendações
- PENSE como coordenador que precisa apresentar isso para a direção AMANHÃ
- Máximo 500 palavras, foco em RESULTADOS e AÇÕES`;

      // Chamar OpenAI
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
      const CHATGPT_MODEL = process.env.CHATGPT_MODEL || "gpt-4o-mini";

      if (!OPENAI_API_KEY) {
        res.status(500).json({
          error: "ChatGPT não configurado. Configure OPENAI_API_KEY nas variáveis de ambiente."
        });
        return;
      }

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: CHATGPT_MODEL,
          messages: [
            {
              role: "system",
              content: "Você é um coordenador pedagógico com 15 anos de experiência em preparação para ENEM. Você é DIRETO, ESPECÍFICO e focado em RESULTADOS. Evite teoria educacional genérica. Foque em ações que podem ser implementadas HOJE e geram resultados em semanas. Use dados e números. Seja conciso."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.8,
          max_tokens: 1500,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI API error: ${JSON.stringify(error)}`);
      }

      const data = await response.json();
      const analysis = data.choices[0].message.content;

      res.json({
        success: true,
        analysis,
        statistics: {
          avgTRI: Math.round(avgTRI),
          totalStudents: students.length,
          grupos,
          areaAnalysis,
        },
      });

    } catch (error) {
      console.error("[Análise IA] Erro:", error);
      res.status(500).json({
        error: "Erro ao gerar análise com IA",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  // ============================================================================
  // ENDPOINT DE ANÁLISE ENEM/TRI COM ASSISTANT API
  // ============================================================================

  app.post("/api/analise-enem-tri", async (req: Request, res: Response) => {
    try {
      const {
        respostasAluno,
        tri,
        anoProva,
        serie,
        infoExtra,
        nomeAluno,
        matricula,
        turma,
        acertos,
        erros,
        nota,
        triLc,
        triCh,
        triCn,
        triMt,
        triGeral,
      } = req.body;

      // Validar dados obrigatórios (tri pode ser triGeral)
      const triValido = tri || triGeral;
      if (!respostasAluno || !triValido || !anoProva) {
        return res.status(400).json({
          error: "Dados obrigatórios faltando",
          details: "respostasAluno, tri (ou triGeral) e anoProva são obrigatórios.",
          required: ["respostasAluno", "tri (ou triGeral)", "anoProva"],
        });
      }

      const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
      const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

      if (!OPENAI_API_KEY) {
        return res.status(500).json({
          error: "OPENAI_API_KEY não configurada. Configure nas variáveis de ambiente.",
        });
      }

      if (!ASSISTANT_ID) {
        return res.status(500).json({
          error: "OPENAI_ASSISTANT_ID não configurada. Configure nas variáveis de ambiente.",
          details: "Você precisa configurar o ID do seu Assistant. Exemplo: export OPENAI_ASSISTANT_ID='asst_...'",
        });
      }

      // Função auxiliar para classificar TRI
      const classificarTRI = (tri: number): string => {
        if (!tri || tri === 0) return '⚪ Não calculado';
        if (tri < 450) return '🔴 Crítico';
        if (tri < 550) return '🟠 Abaixo da média';
        if (tri < 650) return '🟡 Na média';
        if (tri < 750) return '🟢 Acima da média';
        return '🔵 Excelente';
      };

      // Extrair dados de acertos por área do infoExtra (se disponível)
      const acertosPorArea = infoExtra?.acertosPorArea || infoExtra?.scores || {
        LC: infoExtra?.acertosLC || null,
        CH: infoExtra?.acertosCH || null,
        CN: infoExtra?.acertosCN || null,
        MT: infoExtra?.acertosMT || null,
      };

      // Extrair questões erradas do infoExtra (se disponível)
      const questoesErradas = infoExtra?.questoesErradas || {
        LC: infoExtra?.errosLC || [],
        CH: infoExtra?.errosCH || [],
        CN: infoExtra?.errosCN || [],
        MT: infoExtra?.errosMT || [],
      };

      // Extrair análise por questão do infoExtra (para turma)
      const analiseQuestoes = infoExtra?.analiseQuestoes || infoExtra?.questionAnalysis || [];

      // Extrair lista de alunos do infoExtra (para turma)
      const listaAlunos = infoExtra?.alunos || infoExtra?.students || [];

      // Preparar dados estruturados
      const dadosAluno: any = {
        nome: nomeAluno || "Aluno",
        matricula: matricula || "N/A",
        turma: turma || "N/A",
        serie: serie || "N/A",
        anoProva: anoProva,
        respostas: respostasAluno,
        acertosPorArea: acertosPorArea,
        acertosTotal: acertos || 0,
        errosTotal: erros || 0,
        nota: nota || 0,
        tri: {
          geral: triGeral || tri || 0,
          LC: triLc || 0,
          CH: triCh || 0,
          CN: triCn || 0,
          MT: triMt || 0,
        },
        questoesErradas: questoesErradas,
        infoExtra: infoExtra || {},
      };

      // Se infoExtra contém dados de múltiplos alunos, estruturar turma
      if (infoExtra?.totalAlunos) {
        dadosAluno.turmaCompleta = {
          totalAlunos: infoExtra.totalAlunos,
          mediaTRI: infoExtra.mediaTRI || infoExtra.mediaGeral || dadosAluno.tri.geral,
          mediasPorArea: infoExtra.mediasPorArea || {
            LC: triLc || dadosAluno.tri.LC,
            CH: triCh || dadosAluno.tri.CH,
            CN: triCn || dadosAluno.tri.CN,
            MT: triMt || dadosAluno.tri.MT,
          },
          alunos: listaAlunos,
          analiseQuestoes: analiseQuestoes,
          distribuicao: infoExtra.distribuicao || infoExtra.distribuicaoDesempenho || null,
        };
      }

      // Verificar tipo de análise
      const isTurmaCompleta = dadosAluno.turmaCompleta && dadosAluno.turmaCompleta.totalAlunos > 1;
      const isAnaliseCoerencia = infoExtra?.coerenciaPedagogica;

      // ============================================================
      // MONTAGEM DA MENSAGEM - ANÁLISE INDIVIDUAL
      // ============================================================

      const montarMensagemIndividual = (): string => {
        // Verificar se temos acertos por área
        const temAcertosPorArea = acertosPorArea.LC !== null || acertosPorArea.CH !== null;
        const temQuestoesErradas = questoesErradas.LC?.length > 0 || questoesErradas.CH?.length > 0;

        let msg = `
## ANÁLISE INDIVIDUAL DE DESEMPENHO ENEM ${anoProva}

### DADOS DO ALUNO
- **Nome:** ${dadosAluno.nome}
- **Matrícula:** ${dadosAluno.matricula}
- **Turma:** ${dadosAluno.turma}
- **Série:** ${dadosAluno.serie}

### NOTAS TRI (Teoria de Resposta ao Item)

| Área | TRI | Classificação |
|------|-----|---------------|
| Linguagens (LC) | ${dadosAluno.tri.LC.toFixed(2)} | ${classificarTRI(dadosAluno.tri.LC)} |
| Humanas (CH) | ${dadosAluno.tri.CH.toFixed(2)} | ${classificarTRI(dadosAluno.tri.CH)} |
| Natureza (CN) | ${dadosAluno.tri.CN.toFixed(2)} | ${classificarTRI(dadosAluno.tri.CN)} |
| Matemática (MT) | ${dadosAluno.tri.MT.toFixed(2)} | ${classificarTRI(dadosAluno.tri.MT)} |

**TRI Médio Geral:** ${dadosAluno.tri.geral.toFixed(2)} pontos
**Classificação Geral:** ${classificarTRI(dadosAluno.tri.geral)}
`;

        // Adicionar acertos por área se disponível
        if (temAcertosPorArea) {
          msg += `
### ACERTOS POR ÁREA
| Área | Acertos | Total | % |
|------|---------|-------|---|
| LC | ${acertosPorArea.LC || 'N/A'} | 45 | ${acertosPorArea.LC ? ((acertosPorArea.LC / 45) * 100).toFixed(1) + '%' : 'N/A'} |
| CH | ${acertosPorArea.CH || 'N/A'} | 45 | ${acertosPorArea.CH ? ((acertosPorArea.CH / 45) * 100).toFixed(1) + '%' : 'N/A'} |
| CN | ${acertosPorArea.CN || 'N/A'} | 45 | ${acertosPorArea.CN ? ((acertosPorArea.CN / 45) * 100).toFixed(1) + '%' : 'N/A'} |
| MT | ${acertosPorArea.MT || 'N/A'} | 45 | ${acertosPorArea.MT ? ((acertosPorArea.MT / 45) * 100).toFixed(1) + '%' : 'N/A'} |
`;
        } else if (acertos) {
          msg += `
### INFORMAÇÕES COMPLEMENTARES
- **Acertos totais:** ${acertos}
- **Erros totais:** ${erros || 'N/A'}
- **Nota TCT:** ${nota ? nota.toFixed(2) : 'N/A'}
`;
        }

        // Adicionar questões erradas se disponível
        if (temQuestoesErradas) {
          msg += `
### QUESTÕES ERRADAS POR ÁREA
- **LC:** Questões ${questoesErradas.LC?.join(', ') || 'Não informado'}
- **CH:** Questões ${questoesErradas.CH?.join(', ') || 'Não informado'}
- **CN:** Questões ${questoesErradas.CN?.join(', ') || 'Não informado'}
- **MT:** Questões ${questoesErradas.MT?.join(', ') || 'Não informado'}
`;
        }

        // Adicionar coerência pedagógica se disponível
        if (isAnaliseCoerencia) {
          msg += `
### COERÊNCIA PEDAGÓGICA (Análise de Erros por Dificuldade)
- **Erros em questões FÁCEIS (>70% acerto):** ${infoExtra.coerenciaPedagogica.errosFacil}
- **Erros em questões MÉDIAS (40-70% acerto):** ${infoExtra.coerenciaPedagogica.errosMedia}
- **Erros em questões DIFÍCEIS (<40% acerto):** ${infoExtra.coerenciaPedagogica.errosDificil}
`;
        }

        // Instruções para o Assistant
        msg += `
---

## INSTRUÇÕES PARA ANÁLISE

### ⚠️ OBRIGATÓRIO - USE O FILE SEARCH:
1. **Busque no arquivo conteudos_enem_tri.json** para identificar conteúdos relacionados às áreas com TRI baixo
2. **Busque na matriz_referencia.pdf** para descrever as habilidades prioritárias
3. **NÃO invente habilidades genéricas** - cite apenas conteúdos encontrados nos arquivos

### FORMATO OBRIGATÓRIO DA RESPOSTA:

# 📊 DIAGNÓSTICO INDIVIDUAL - ${dadosAluno.nome}

## 1. Resumo do Desempenho
[Tabela com TRI por área e classificação - usar os dados acima]

## 2. Diagnóstico por Área
Para CADA área com TRI abaixo de 550:
- Identificar como área prioritária
- **BUSCAR no conteudos_enem_tri.json** conteúdos dessa área
- Listar habilidades específicas no formato: "H[X] - [Descrição do JSON] (TRI: XXX)"

## 3. Prioridades de Estudo
Ordenar áreas por urgência (menor TRI primeiro):
- Listar 3-5 conteúdos específicos do JSON para cada área crítica
- Incluir tempo sugerido de estudo

## 4. Metas Realistas
- Calcular gap para atingir 550 TRI em cada área
- Estimar quantos pontos precisa melhorar

### ❌ NÃO FAÇA:
- Não invente habilidades como "H1 - Interpretar textos" (genérico)
- Não liste conteúdos sem buscar no arquivo

### ✅ FAÇA:
- Busque no JSON e cite: "H1 Linguagens - Gênero crônica com efeito de humor (TRI: 522.8)"
- Use dados REAIS do arquivo conteudos_enem_tri.json
`;

        return msg;
      };

      // ============================================================
      // MONTAGEM DA MENSAGEM - ANÁLISE DE TURMA
      // ============================================================

      const montarMensagemTurma = (): string => {
        const turmaData = dadosAluno.turmaCompleta;

        // Montar ranking se disponível
        let rankingTexto = 'Não disponível';
        if (turmaData.alunos && turmaData.alunos.length > 0) {
          const alunosOrdenados = [...turmaData.alunos]
            .sort((a: any, b: any) => (b.tri?.geral || b.triGeral || 0) - (a.tri?.geral || a.triGeral || 0))
            .slice(0, 10);

          rankingTexto = alunosOrdenados
            .map((aluno: any, idx: number) => {
              const triAluno = aluno.tri?.geral || aluno.triGeral || 0;
              return `${idx + 1}. ${aluno.nome || aluno.name} - TRI: ${triAluno.toFixed(2)}`;
            })
            .join('\n');
        }

        // Questões críticas se disponível
        let questoesCriticasTexto = 'Não disponível';
        if (turmaData.analiseQuestoes && turmaData.analiseQuestoes.length > 0) {
          const criticas = turmaData.analiseQuestoes
            .filter((q: any) => (q.percentualAcertos || q.percentual || 0) < 50)
            .sort((a: any, b: any) => (a.percentualAcertos || a.percentual || 0) - (b.percentualAcertos || b.percentual || 0))
            .slice(0, 15);

          if (criticas.length > 0) {
            questoesCriticasTexto = criticas
              .map((q: any) => `Q${q.questao || q.numero} (${q.area}): ${(q.percentualAcertos || q.percentual || 0).toFixed(1)}% acertos`)
              .join('\n');
          }
        }

        // Alunos em situação crítica
        let alunosCriticosTexto = 'Nenhum identificado';
        if (turmaData.alunos && turmaData.alunos.length > 0) {
          const criticos = turmaData.alunos
            .filter((a: any) => (a.tri?.geral || a.triGeral || 0) < 450);

          if (criticos.length > 0) {
            alunosCriticosTexto = criticos
              .map((a: any) => `- ${a.nome || a.name}: TRI ${(a.tri?.geral || a.triGeral || 0).toFixed(2)}`)
              .join('\n');
          }
        }

        let msg = `
## ANÁLISE DE TURMA COMPLETA - ENEM ${anoProva}

### DADOS DA TURMA
- **Identificação:** ${dadosAluno.turma}
- **Série:** ${dadosAluno.serie}
- **Total de Alunos:** ${turmaData.totalAlunos}

### MÉDIAS TRI DA TURMA

| Área | TRI Médio | Classificação |
|------|-----------|---------------|
| Linguagens (LC) | ${(turmaData.mediasPorArea?.LC || dadosAluno.tri.LC).toFixed(2)} | ${classificarTRI(turmaData.mediasPorArea?.LC || dadosAluno.tri.LC)} |
| Humanas (CH) | ${(turmaData.mediasPorArea?.CH || dadosAluno.tri.CH).toFixed(2)} | ${classificarTRI(turmaData.mediasPorArea?.CH || dadosAluno.tri.CH)} |
| Natureza (CN) | ${(turmaData.mediasPorArea?.CN || dadosAluno.tri.CN).toFixed(2)} | ${classificarTRI(turmaData.mediasPorArea?.CN || dadosAluno.tri.CN)} |
| Matemática (MT) | ${(turmaData.mediasPorArea?.MT || dadosAluno.tri.MT).toFixed(2)} | ${classificarTRI(turmaData.mediasPorArea?.MT || dadosAluno.tri.MT)} |

**TRI Médio Geral da Turma:** ${turmaData.mediaTRI.toFixed(2)} pontos
**Classificação Geral:** ${classificarTRI(turmaData.mediaTRI)}

### RANKING DOS ALUNOS (Top 10)
${rankingTexto}

### QUESTÕES MAIS ERRADAS PELA TURMA (< 50% acertos)
${questoesCriticasTexto}

### ALUNOS EM SITUAÇÃO CRÍTICA (TRI < 450)
${alunosCriticosTexto}

---

## INSTRUÇÕES PARA ANÁLISE

### ⚠️ OBRIGATÓRIO - USE O FILE SEARCH:
1. **Para cada área com TRI baixo**, busque no arquivo **conteudos_enem_tri.json** conteúdos específicos
2. **Busque na matriz_referencia.pdf** as habilidades prioritárias para reforço coletivo
3. **NÃO invente habilidades genéricas** - cite apenas conteúdos encontrados nos arquivos

### FORMATO OBRIGATÓRIO DA RESPOSTA:

# 📊 RELATÓRIO EXECUTIVO - TURMA ${dadosAluno.turma}

## 1. Panorama Geral
- Total de alunos: ${turmaData.totalAlunos}
- TRI médio vs. média nacional (~500)
- Distribuição: quantos acima/abaixo da média

## 2. Desempenho por Área
- Identificar área mais forte e mais fraca
- Comparar com referencial nacional

## 3. Questões Críticas (Turma Errou Coletivamente)
Para cada questão com baixo % de acertos:
- **BUSCAR no conteudos_enem_tri.json** qual conteúdo ela cobra
- Formato: "Q[X] ([Área]) - [Conteúdo do JSON] (TRI: XXX)"

## 4. Destaques
- Top 5 alunos (usar ranking acima)
- Alunos que precisam de atenção especial

## 5. Recomendações Pedagógicas
- Conteúdos para reforço COLETIVO (buscar no JSON)
- Estratégias de intervenção por grupo

### ❌ NÃO FAÇA:
- Não invente habilidades genéricas
- Não liste conteúdos sem buscar no arquivo

### ✅ FAÇA:
- Busque no JSON e cite conteúdos REAIS
- Use o formato: "H[X] [Área] - [Descrição] (TRI: XXX)"
`;

        return msg;
      };

      // ============================================================
      // MONTAGEM FINAL DA MENSAGEM
      // ============================================================

      let mensagemUsuario: string;

      if (isTurmaCompleta) {
        mensagemUsuario = montarMensagemTurma();
      } else {
        mensagemUsuario = montarMensagemIndividual();
      }

      // Criar thread no Assistant API
      const threadResponse = await fetch("https://api.openai.com/v1/threads", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        },
      });

      if (!threadResponse.ok) {
        const error = await threadResponse.json();
        throw new Error(`Erro ao criar thread: ${JSON.stringify(error)}`);
      }

      const threadData = await threadResponse.json();
      const threadId = threadData.id;

      // Adicionar mensagem do usuário à thread
      const messageResponse = await fetch(
        `https://api.openai.com/v1/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
            "OpenAI-Beta": "assistants=v2",
          },
          body: JSON.stringify({
            role: "user",
            content: mensagemUsuario,
          }),
        }
      );

      if (!messageResponse.ok) {
        const error = await messageResponse.json();
        throw new Error(`Erro ao adicionar mensagem: ${JSON.stringify(error)}`);
      }

      // Executar o run do Assistant
      const runResponse = await fetch(
        `https://api.openai.com/v1/threads/${threadId}/runs`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
            "OpenAI-Beta": "assistants=v2",
          },
          body: JSON.stringify({
            assistant_id: ASSISTANT_ID,
          }),
        }
      );

      if (!runResponse.ok) {
        const error = await runResponse.json();
        const errorMsg = error.error?.message || JSON.stringify(error);

        // Mensagem mais clara para erro de Assistant não encontrado
        if (errorMsg.includes("No assistant found")) {
          throw new Error(
            `Assistant ID não encontrado: ${ASSISTANT_ID}\n` +
            `Verifique se o ID está correto e se o Assistant existe na sua conta OpenAI.\n` +
            `Acesse: https://platform.openai.com/assistants para verificar.`
          );
        }

        throw new Error(`Erro ao executar run: ${errorMsg}`);
      }

      const runData = await runResponse.json();
      let runId = runData.id;
      let runStatus = runData.status;

      // Aguardar conclusão do run (polling)
      const maxAttempts = 60; // 60 tentativas = ~60 segundos
      let attempts = 0;

      while (runStatus === "queued" || runStatus === "in_progress") {
        if (attempts >= maxAttempts) {
          throw new Error("Timeout aguardando resposta do Assistant");
        }

        await new Promise((resolve) => setTimeout(resolve, 1000)); // Aguardar 1 segundo

        const statusResponse = await fetch(
          `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
          {
            headers: {
              "Authorization": `Bearer ${OPENAI_API_KEY}`,
              "OpenAI-Beta": "assistants=v2",
            },
          }
        );

        if (!statusResponse.ok) {
          const error = await statusResponse.json();
          throw new Error(`Erro ao verificar status: ${JSON.stringify(error)}`);
        }

        const statusData = await statusResponse.json();
        runStatus = statusData.status;
        attempts++;

        if (runStatus === "failed" || runStatus === "cancelled") {
          throw new Error(`Run falhou com status: ${runStatus}`);
        }
      }

      // Buscar mensagens da thread
      const messagesResponse = await fetch(
        `https://api.openai.com/v1/threads/${threadId}/messages`,
        {
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta": "assistants=v2",
          },
        }
      );

      if (!messagesResponse.ok) {
        const error = await messagesResponse.json();
        throw new Error(`Erro ao buscar mensagens: ${JSON.stringify(error)}`);
      }

      const messagesData = await messagesResponse.json();

      // Encontrar a última mensagem do assistant
      const assistantMessages = messagesData.data
        .filter((msg: any) => msg.role === "assistant")
        .sort((a: any, b: any) => b.created_at - a.created_at);

      if (assistantMessages.length === 0) {
        throw new Error("Nenhuma resposta do Assistant encontrada");
      }

      const lastMessage = assistantMessages[0];
      let analiseTexto = "";

      // Extrair texto da mensagem (pode ser texto ou array de content blocks)
      if (lastMessage.content) {
        if (Array.isArray(lastMessage.content)) {
          analiseTexto = lastMessage.content
            .map((block: any) => {
              if (block.type === "text") {
                // Suportar diferentes estruturas
                if (block.text && typeof block.text.value === "string") {
                  return block.text.value;
                } else if (typeof block.text === "string") {
                  return block.text;
                } else if (typeof block === "string") {
                  return block;
                }
              }
              return "";
            })
            .filter((text: string) => text.trim().length > 0)
            .join("\n\n");
        } else if (typeof lastMessage.content === "string") {
          analiseTexto = lastMessage.content;
        } else if (lastMessage.content.text) {
          analiseTexto = typeof lastMessage.content.text === "string"
            ? lastMessage.content.text
            : lastMessage.content.text.value || "";
        }
      }

      // Se ainda não encontrou, tentar outros campos
      if (!analiseTexto && lastMessage.text) {
        analiseTexto = typeof lastMessage.text === "string"
          ? lastMessage.text
          : lastMessage.text.value || "";
      }

      // Log para debug se não encontrar
      if (!analiseTexto || analiseTexto.trim().length === 0) {
        console.error("[Analise ENEM TRI] Estrutura da mensagem:", JSON.stringify(lastMessage, null, 2));
      }

      // Retornar análise (usar 'analysis' para compatibilidade com frontend)
      if (!analiseTexto || analiseTexto.trim().length === 0) {
        throw new Error("Resposta da IA não contém análise");
      }

      res.json({
        success: true,
        analysis: analiseTexto.trim(), // Frontend espera 'analysis'
        analise: analiseTexto.trim(), // Manter compatibilidade
        threadId: threadId,
        runId: runId,
        dadosProcessados: {
          nomeAluno: dadosAluno.nome,
          anoProva: dadosAluno.anoProva,
          triGeral: dadosAluno.tri.geral,
        },
      });

    } catch (error) {
      console.error("[Análise ENEM/TRI] Erro:", error);
      res.status(500).json({
        error: "Erro ao gerar análise com Assistant",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  // ============================================================================
  // ENDPOINT DE ANÁLISE ESCOLA (Modo Escola)
  // ============================================================================

  app.post("/api/analise-escola", async (req: Request, res: Response) => {
    try {
      const {
        modo,
        nomeProjeto,
        totalAlunos,
        disciplinas,
        triMedioGeral,
        tctMedioGeral,
        taxaAcertosGeral,
        serie,
        turma,
        infoExtra,
      } = req.body;

      // Validar dados obrigatórios
      if (!disciplinas || disciplinas.length === 0) {
        return res.status(400).json({
          error: "Dados obrigatórios faltando",
          details: "disciplinas é obrigatório e deve conter ao menos uma disciplina.",
        });
      }

      const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

      if (!OPENAI_API_KEY) {
        return res.status(500).json({
          error: "OPENAI_API_KEY não configurada. Configure nas variáveis de ambiente.",
        });
      }

      // Montar mensagem para análise
      const disciplinasTexto = disciplinas.map((d: any) =>
        `- **${d.disciplina} (${d.abreviacao})**: TCT Médio: ${d.tctMedio.toFixed(1)} | TRI Médio: ${d.triMedio > 0 ? d.triMedio.toFixed(0) : 'N/A'} | Acertos: ${d.acertosMedio.toFixed(1)}/${d.totalQuestoes} (${d.taxaAcertos.toFixed(0)}%)`
      ).join('\n');

      // Identificar disciplinas críticas
      const disciplinasCriticas = disciplinas
        .filter((d: any) => d.taxaAcertos < 50)
        .map((d: any) => d.disciplina);

      const disciplinasFortes = disciplinas
        .filter((d: any) => d.taxaAcertos >= 60)
        .map((d: any) => d.disciplina);

      const mensagemUsuario = `
## ANÁLISE PEDAGÓGICA - PROJETO ESCOLA

### DADOS GERAIS
- **Projeto:** ${nomeProjeto || 'Projeto Escola'}
- **Total de Alunos:** ${totalAlunos}
- **Série/Turma:** ${serie || 'N/A'} / ${turma || 'N/A'}
- **Total de Disciplinas Avaliadas:** ${disciplinas.length}

### MÉTRICAS GERAIS
- **TRI Médio Geral:** ${triMedioGeral > 0 ? triMedioGeral.toFixed(0) : 'Não calculado'}
- **TCT Médio Geral:** ${tctMedioGeral.toFixed(1)} (escala 0-10)
- **Taxa de Acertos Geral:** ${taxaAcertosGeral.toFixed(0)}%

### DESEMPENHO POR DISCIPLINA
${disciplinasTexto}

### DISCIPLINAS QUE PRECISAM DE ATENÇÃO
${disciplinasCriticas.length > 0 ? disciplinasCriticas.join(', ') : 'Nenhuma disciplina crítica identificada'}

### DISCIPLINAS COM BOM DESEMPENHO
${disciplinasFortes.length > 0 ? disciplinasFortes.join(', ') : 'Nenhuma disciplina com desempenho acima de 60%'}

---

## INSTRUÇÕES PARA ANÁLISE

Você é um especialista em avaliação educacional e gestão pedagógica. Com base nos dados acima, forneça uma análise diagnóstica completa seguindo esta estrutura:

### 1. VISÃO GERAL DO DESEMPENHO
- Avalie o desempenho geral da turma
- Compare TCT e TRI (se disponível)
- Identifique padrões gerais

### 2. ANÁLISE POR DISCIPLINA
Para cada disciplina:
- Avalie se o desempenho está adequado
- Identifique possíveis causas para baixo/alto desempenho
- Sugira conteúdos que podem precisar de reforço

### 3. PONTOS FORTES DA TURMA
- Destaque disciplinas ou áreas com bom desempenho
- Sugira como aproveitar esses pontos fortes

### 4. PONTOS DE ATENÇÃO
- Liste disciplinas/áreas que precisam de intervenção
- Priorize por urgência

### 5. RECOMENDAÇÕES PEDAGÓGICAS
- Estratégias de intervenção específicas
- Sugestões para reforço escolar
- Atividades complementares recomendadas

### 6. PRÓXIMOS PASSOS
- Ações imediatas (próximas 2 semanas)
- Ações de médio prazo (próximo mês)
- Monitoramento sugerido

**Formato:** Use linguagem clara e objetiva, adequada para coordenadores pedagógicos e professores. Inclua dados numéricos quando relevante.
`;

      // Chamar OpenAI Chat Completions (mais simples que Assistant API)
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "Você é um especialista em avaliação educacional e gestão pedagógica escolar. Sua função é analisar dados de desempenho de turmas e fornecer insights pedagógicos acionáveis para coordenadores e professores. Seja objetivo, use dados e forneça recomendações práticas."
            },
            {
              role: "user",
              content: mensagemUsuario
            }
          ],
          temperature: 0.7,
          max_tokens: 2500,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI API error: ${JSON.stringify(error)}`);
      }

      const data = await response.json();
      const analiseTexto = data.choices?.[0]?.message?.content;

      if (!analiseTexto) {
        throw new Error("Resposta da IA não contém análise");
      }

      res.json({
        success: true,
        analysis: analiseTexto.trim(),
        dadosProcessados: {
          nomeProjeto,
          totalAlunos,
          disciplinasCount: disciplinas.length,
          tctMedioGeral,
          triMedioGeral,
        },
      });

    } catch (error) {
      console.error("[Análise Escola] Erro:", error);
      res.status(500).json({
        error: "Erro ao gerar análise",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  // ============================================================================
  // ENDPOINTS DE HISTÓRICO DE AVALIAÇÕES
  // ============================================================================

  const AVALIACOES_FILE = path.join(process.cwd(), "data", "avaliacoes.json");

  // Garantir que o diretório existe
  async function ensureAvaliacoesFile() {
    const dir = path.dirname(AVALIACOES_FILE);
    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.access(AVALIACOES_FILE);
    } catch {
      // Arquivo não existe, criar com array vazio
      await fs.writeFile(AVALIACOES_FILE, JSON.stringify([], null, 2), "utf-8");
    }
  }

  // POST /api/avaliacoes - Salvar avaliação
  // GAB-201: POST /api/avaliacoes - Salvar avaliação no Supabase
  // PROTEGIDO: Apenas admins podem salvar avaliações
  app.post("/api/avaliacoes", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const {
        titulo,
        templateType = "ENEM",
        totalQuestoes = 90,
        gabarito,
        answerKey, // GAB-204: Aceitar tanto "gabarito" quanto "answerKey"
        questionContents,
        alunos: alunosOriginal,
        students: studentsOriginal, // GAB-203: Aceitar "students" do frontend
        school_id,
        schoolId, // GAB-203: Aceitar camelCase também
        created_by
      } = req.body;

      // GAB-204: Aceitar tanto "gabarito" quanto "answerKey" do frontend
      const finalAnswerKey = gabarito || answerKey || null;

      // GAB-203: Aceitar tanto "alunos" quanto "students", e school_id ou schoolId
      const alunos = alunosOriginal || studentsOriginal;

      // Validar dados obrigatórios
      if (!titulo) {
        return res.status(400).json({ error: "Título é obrigatório" });
      }
      if (!alunos || !Array.isArray(alunos) || alunos.length === 0) {
        return res.status(400).json({ error: "Lista de alunos é obrigatória" });
      }

      // GAB-203: Aceitar school_id ou schoolId, com fallback para escola padrão
      let finalSchoolId = school_id || schoolId;

      // Se não tiver school_id, buscar/criar escola padrão
      if (!finalSchoolId) {
        const { data: defaultSchool } = await supabaseAdmin
          .from("schools")
          .select("id")
          .eq("slug", "demo")
          .single();

        if (defaultSchool) {
          finalSchoolId = defaultSchool.id;
          console.log(`[AVALIACOES] Usando escola padrão: ${finalSchoolId}`);
        } else {
          // Criar escola demo se não existir
          const { data: newSchool, error: schoolError } = await supabaseAdmin
            .from("schools")
            .insert({ name: "Escola Demo", slug: "demo" })
            .select()
            .single();

          if (schoolError) {
            console.error("[AVALIACOES] Erro ao criar escola padrão:", schoolError);
            return res.status(500).json({ error: "Erro ao criar escola padrão" });
          }
          finalSchoolId = newSchool.id;
          console.log(`[AVALIACOES] Escola padrão criada: ${finalSchoolId}`);
        }
      }

      console.log(`[AVALIACOES] Criando avaliação: ${titulo} com ${alunos.length} alunos`);

      // 1. Criar o exam no Supabase
      const { data: exam, error: examError } = await supabaseAdmin
        .from("exams")
        .insert({
          school_id: finalSchoolId,
          created_by: created_by || null,
          title: titulo,
          template_type: templateType,
          total_questions: totalQuestoes,
          answer_key: finalAnswerKey, // GAB-204: Usar finalAnswerKey que aceita gabarito ou answerKey
          question_contents: questionContents || null,
          status: "active"
        })
        .select()
        .single();

      if (examError) {
        console.error("[AVALIACOES] Erro ao criar exam:", examError);
        return res.status(500).json({
          error: "Erro ao criar avaliação",
          details: examError.message
        });
      }

      console.log(`[AVALIACOES] Exam criado: ${exam.id}`);

      // 2. GAB-203: Usar função transformStudentsForSupabase para converter dados
      const transformedStudents = transformStudentsForSupabase(
        alunos as StudentDataFrontend[],
        exam.id,
        finalSchoolId,
        totalQuestoes
      );

      // 3. Buscar student_ids em batch para vincular alunos cadastrados
      const studentNumbers = transformedStudents
        .map(s => s.student_number)
        .filter((sn): sn is string => sn !== null);

      const profileMap = new Map<string, string>();

      if (studentNumbers.length > 0) {
        const { data: profiles } = await supabaseAdmin
          .from("profiles")
          .select("id, student_number")
          .in("student_number", studentNumbers);

        profiles?.forEach(p => {
          if (p.student_number) {
            profileMap.set(p.student_number, p.id);
          }
        });
      }

      // 4. Adicionar student_id aos registros transformados
      const studentAnswersToInsert = transformedStudents.map(student => ({
        ...student,
        student_id: student.student_number ? (profileMap.get(student.student_number) || null) : null
      }));

      // Inserir em batch
      const { data: insertedAnswers, error: answersError } = await supabaseAdmin
        .from("student_answers")
        .insert(studentAnswersToInsert)
        .select();

      if (answersError) {
        console.error("[AVALIACOES] Erro ao inserir respostas:", answersError);
        // Deletar o exam criado para manter consistência
        await supabaseAdmin.from("exams").delete().eq("id", exam.id);
        return res.status(500).json({
          error: "Erro ao salvar respostas dos alunos",
          details: answersError.message
        });
      }

      console.log(`[AVALIACOES] ${insertedAnswers?.length || 0} respostas salvas para exam ${exam.id}`);

      res.json({
        success: true,
        id: exam.id,
        examId: exam.id,
        totalAlunos: insertedAnswers?.length || 0,
        message: `Avaliação "${titulo}" publicada com sucesso!`
      });
    } catch (error: any) {
      console.error("[AVALIACOES] Erro ao salvar:", error);
      res.status(500).json({
        error: "Erro ao salvar avaliação",
        details: error.message
      });
    }
  });

  // GAB-201: GET /api/avaliacoes - Listar avaliações do Supabase
  // PROTEGIDO: Apenas admins podem listar avaliações
  app.get("/api/avaliacoes", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const { school_id } = req.query;

      // Buscar exams do Supabase
      let query = supabaseAdmin
        .from("exams")
        .select(`
          id,
          title,
          template_type,
          total_questions,
          status,
          created_at,
          created_by,
          school_id,
          answer_key
        `)
        .order("created_at", { ascending: false });

      // Filtrar por school_id se fornecido
      if (school_id) {
        query = query.eq("school_id", school_id);
      }

      const { data: exams, error: examsError } = await query;

      if (examsError) {
        console.error("[AVALIACOES] Erro ao listar:", examsError);
        return res.status(500).json({
          error: "Erro ao listar avaliações",
          details: examsError.message
        });
      }

      // Para cada exam, contar os alunos (student_answers)
      const avaliacoes = await Promise.all(
        (exams || []).map(async (exam) => {
          const { count } = await supabaseAdmin
            .from("student_answers")
            .select("*", { count: "exact", head: true })
            .eq("exam_id", exam.id);

          return {
            id: exam.id,
            titulo: exam.title,
            templateType: exam.template_type,
            totalQuestoes: exam.total_questions,
            totalAlunos: count || 0,
            status: exam.status,
            data: exam.created_at,
            createdAt: exam.created_at,
            schoolId: exam.school_id,
            gabarito: exam.answer_key
          };
        })
      );

      res.json({
        success: true,
        avaliacoes,
        total: avaliacoes.length
      });
    } catch (error: any) {
      console.error("[AVALIACOES] Erro ao listar:", error);
      res.status(500).json({
        error: "Erro ao listar avaliações",
        details: error.message
      });
    }
  });

  // GAB-201: GET /api/avaliacoes/:id - Buscar avaliação específica do Supabase
  // PROTEGIDO: Apenas admins podem ver avaliações
  app.get("/api/avaliacoes/:id", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Buscar exam
      const { data: exam, error: examError } = await supabaseAdmin
        .from("exams")
        .select("*")
        .eq("id", id)
        .single();

      if (examError || !exam) {
        return res.status(404).json({ error: "Avaliação não encontrada" });
      }

      // Buscar student_answers relacionados
      const { data: studentAnswers, error: answersError } = await supabaseAdmin
        .from("student_answers")
        .select("*")
        .eq("exam_id", id)
        .order("student_name", { ascending: true });

      if (answersError) {
        console.error("[AVALIACOES] Erro ao buscar respostas:", answersError);
      }

      // GAB-203: Usar função transformStudentFromSupabase para converter dados
      const alunos = (studentAnswers || []).map((sa) =>
        transformStudentFromSupabase(sa as StudentAnswerSupabase)
      );

      const avaliacao = {
        id: exam.id,
        titulo: exam.title,
        templateType: exam.template_type,
        totalQuestoes: exam.total_questions,
        totalAlunos: alunos.length,
        status: exam.status,
        data: exam.created_at,
        createdAt: exam.created_at,
        schoolId: exam.school_id,
        gabarito: exam.answer_key,
        questionContents: exam.question_contents,
        alunos
      };

      res.json({
        success: true,
        avaliacao
      });
    } catch (error: any) {
      console.error("[AVALIACOES] Erro ao buscar:", error);
      res.status(500).json({
        error: "Erro ao buscar avaliação",
        details: error.message
      });
    }
  });

  // GAB-201: DELETE /api/avaliacoes/:id - Deletar avaliação do Supabase
  // PROTEGIDO: Apenas admins podem deletar avaliações
  app.delete("/api/avaliacoes/:id", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Verificar se exam existe
      const { data: exam, error: checkError } = await supabaseAdmin
        .from("exams")
        .select("id, title")
        .eq("id", id)
        .single();

      if (checkError || !exam) {
        return res.status(404).json({ error: "Avaliação não encontrada" });
      }

      // 1. Deletar student_answers relacionados primeiro (foreign key)
      const { error: answersDeleteError } = await supabaseAdmin
        .from("student_answers")
        .delete()
        .eq("exam_id", id);

      if (answersDeleteError) {
        console.error("[AVALIACOES] Erro ao deletar respostas:", answersDeleteError);
        return res.status(500).json({
          error: "Erro ao deletar respostas dos alunos",
          details: answersDeleteError.message
        });
      }

      // 2. Deletar o exam
      const { error: examDeleteError } = await supabaseAdmin
        .from("exams")
        .delete()
        .eq("id", id);

      if (examDeleteError) {
        console.error("[AVALIACOES] Erro ao deletar exam:", examDeleteError);
        return res.status(500).json({
          error: "Erro ao deletar avaliação",
          details: examDeleteError.message
        });
      }

      console.log(`[AVALIACOES] Avaliação deletada: ${id} - ${exam.title}`);

      res.json({
        success: true,
        message: "Avaliação deletada com sucesso"
      });
    } catch (error: any) {
      console.error("[AVALIACOES] Erro ao deletar:", error);
      res.status(500).json({
        error: "Erro ao deletar avaliação",
        details: error.message
      });
    }
  });

  // ============================================
  // PROJETOS - Sistema de Persistência (Supabase)
  // ============================================

  // Helper para converter snake_case do DB para camelCase do frontend
  function projetoDbToFrontend(dbRow: any): any {
    return {
      id: dbRow.id,
      nome: dbRow.nome,
      descricao: dbRow.descricao,
      template: dbRow.template,
      students: dbRow.students || [],
      answerKey: dbRow.answer_key || [],
      questionContents: dbRow.question_contents || [],
      statistics: dbRow.statistics,
      triScores: dbRow.tri_scores,
      triScoresByArea: dbRow.tri_scores_by_area,
      dia1Processado: dbRow.dia1_processado || false,
      dia2Processado: dbRow.dia2_processado || false,
      createdAt: dbRow.created_at,
      updatedAt: dbRow.updated_at
    };
  }

  // POST /api/projetos - Salvar novo projeto
  // PROTEGIDO: Apenas super_admin pode gerenciar projetos
  app.post("/api/projetos", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
    try {
      const {
        nome,
        descricao,
        template,
        students,
        answerKey,
        questionContents,
        statistics,
        triScores,
        triScoresByArea,
        dia1Processado: dia1ProcessadoEnviado,
        dia2Processado: dia2ProcessadoEnviado
      } = req.body;

      if (!nome || nome.trim() === "") {
        res.status(400).json({ error: "Nome do projeto é obrigatório" });
        return;
      }

      const { data, error } = await supabaseAdmin
        .from('projetos')
        .insert({
          nome: nome.trim(),
          descricao: descricao || "",
          template: template || null,
          students: students || [],
          answer_key: answerKey || [],
          question_contents: questionContents || [],
          statistics: statistics || null,
          tri_scores: triScores || null,
          tri_scores_by_area: triScoresByArea || null,
          dia1_processado: dia1ProcessadoEnviado ?? template?.name === "ENEM - Dia 1",
          dia2_processado: dia2ProcessadoEnviado ?? template?.name === "ENEM - Dia 2"
        })
        .select()
        .single();

      if (error) {
        console.error("[PROJETOS] Erro Supabase ao salvar:", error);
        throw error;
      }

      const novoProjeto = projetoDbToFrontend(data);
      console.log(`[PROJETOS] Projeto "${nome}" salvo com ${students?.length || 0} alunos (Supabase)`);

      res.json({
        success: true,
        projeto: novoProjeto,
        message: `Projeto "${nome}" salvo com sucesso!`
      });
    } catch (error: any) {
      console.error("[PROJETOS] Erro ao salvar:", error);
      res.status(500).json({
        error: "Erro ao salvar projeto",
        details: error.message
      });
    }
  });

  // GET /api/projetos - Listar todos os projetos
  // PROTEGIDO: Apenas super_admin pode ver projetos
  app.get("/api/projetos", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('projetos')
        .select('id, nome, descricao, template, students, dia1_processado, dia2_processado, created_at, updated_at')
        .order('updated_at', { ascending: false });

      if (error) {
        console.error("[PROJETOS] Erro Supabase ao listar:", error);
        throw error;
      }

      // Retornar lista resumida (sem dados pesados)
      const lista = (data || []).map(p => ({
        id: p.id,
        nome: p.nome,
        descricao: p.descricao,
        template: (p.template as any)?.name || p.template,
        totalAlunos: (p.students as any[])?.length || 0,
        dia1Processado: p.dia1_processado || false,
        dia2Processado: p.dia2_processado || false,
        createdAt: p.created_at,
        updatedAt: p.updated_at
      }));

      res.json({
        success: true,
        projetos: lista
      });
    } catch (error: any) {
      console.error("[PROJETOS] Erro ao listar:", error);
      res.status(500).json({
        error: "Erro ao listar projetos",
        details: error.message
      });
    }
  });

  // GET /api/projetos/:id - Carregar projeto específico
  // PROTEGIDO: Apenas super_admin pode ver projetos
  app.get("/api/projetos/:id", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const { data, error } = await supabaseAdmin
        .from('projetos')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          res.status(404).json({ error: "Projeto não encontrado" });
          return;
        }
        console.error("[PROJETOS] Erro Supabase ao buscar:", error);
        throw error;
      }

      res.json({
        success: true,
        projeto: projetoDbToFrontend(data)
      });
    } catch (error: any) {
      console.error("[PROJETOS] Erro ao buscar:", error);
      res.status(500).json({
        error: "Erro ao buscar projeto",
        details: error.message
      });
    }
  });

  // PUT /api/projetos/:id - Atualizar projeto (usado para merge Dia1+Dia2)
  // PROTEGIDO: Apenas super_admin pode atualizar projetos
  app.put("/api/projetos/:id", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const {
        nome,
        descricao,
        template,
        students,
        answerKey,
        questionContents,
        statistics,
        triScores,
        triScoresByArea,
        mergeStudents, // Flag para mesclar alunos por matrícula
        dia1Processado: dia1ProcessadoEnviado,
        dia2Processado: dia2ProcessadoEnviado
      } = req.body;

      // Buscar projeto existente no Supabase
      const { data: existingData, error: fetchError } = await supabaseAdmin
        .from('projetos')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          res.status(404).json({ error: "Projeto não encontrado" });
          return;
        }
        throw fetchError;
      }

      const projetoExistente = projetoDbToFrontend(existingData);

      // Se mergeStudents = true, mesclar alunos por matrícula
      let studentsFinais = students || projetoExistente.students;
      let answerKeyFinal = answerKey || projetoExistente.answerKey;

      if (mergeStudents && students && projetoExistente.students) {
        console.log(`[PROJETOS] Mesclando ${students.length} novos alunos com ${projetoExistente.students.length} existentes`);

        const isDia2 = template?.name === "ENEM - Dia 2";
        const isDia1 = template?.name === "ENEM - Dia 1";

        // Criar mapa de alunos existentes por matrícula
        const mapaExistentes = new Map();
        for (const student of projetoExistente.students) {
          const chave = student.studentNumber || student.studentName;
          mapaExistentes.set(chave, student);
        }

        // Mesclar novos alunos
        for (const novoAluno of students) {
          const chave = novoAluno.studentNumber || novoAluno.studentName;
          const existente = mapaExistentes.get(chave);

          if (existente) {
            // Aluno já existe - mesclar respostas
            console.log(`[PROJETOS] Mesclando aluno: ${chave}`);

            // Criar array de 180 respostas
            const respostasMescladas = Array(180).fill("");

            // Copiar respostas existentes
            if (existente.answers) {
              // Se existente é Dia 1 (90 respostas = Q1-90)
              if (projetoExistente.dia1Processado && !projetoExistente.dia2Processado) {
                existente.answers.forEach((ans: string, idx: number) => {
                  if (idx < 90) respostasMescladas[idx] = ans || "";
                });
              }
              // Se existente é Dia 2 (90 respostas = Q91-180)
              else if (projetoExistente.dia2Processado && !projetoExistente.dia1Processado) {
                existente.answers.forEach((ans: string, idx: number) => {
                  if (idx < 90) respostasMescladas[90 + idx] = ans || "";
                });
              }
              // Se existente já tem 180
              else {
                existente.answers.forEach((ans: string, idx: number) => {
                  if (idx < 180) respostasMescladas[idx] = ans || "";
                });
              }
            }

            // Adicionar novas respostas
            if (novoAluno.answers) {
              if (isDia2) {
                // Novo é Dia 2: colocar em 90-179
                novoAluno.answers.forEach((ans: string, idx: number) => {
                  if (idx < 90) respostasMescladas[90 + idx] = ans || "";
                });
              } else if (isDia1) {
                // Novo é Dia 1: colocar em 0-89
                novoAluno.answers.forEach((ans: string, idx: number) => {
                  if (idx < 90) respostasMescladas[idx] = ans || "";
                });
              }
            }

            // Atualizar aluno existente
            existente.answers = respostasMescladas;
            existente.areaCorrectAnswers = {}; // Resetar para recalcular
            existente.areaScores = {}; // Resetar para recalcular

            // Mesclar scores se houver
            if (novoAluno.areaScores) {
              existente.areaScores = { ...existente.areaScores, ...novoAluno.areaScores };
            }
            if (novoAluno.areaCorrectAnswers) {
              existente.areaCorrectAnswers = { ...existente.areaCorrectAnswers, ...novoAluno.areaCorrectAnswers };
            }

            mapaExistentes.set(chave, existente);
          } else {
            // Aluno novo - adicionar com respostas em 180 elementos
            const respostas180 = Array(180).fill("");
            if (novoAluno.answers) {
              if (isDia2) {
                novoAluno.answers.forEach((ans: string, idx: number) => {
                  if (idx < 90) respostas180[90 + idx] = ans || "";
                });
              } else {
                novoAluno.answers.forEach((ans: string, idx: number) => {
                  if (idx < 180) respostas180[idx] = ans || "";
                });
              }
            }
            novoAluno.answers = respostas180;
            mapaExistentes.set(chave, novoAluno);
          }
        }

        studentsFinais = Array.from(mapaExistentes.values());

        // Mesclar answerKey também (180 elementos)
        if (answerKey && projetoExistente.answerKey) {
          answerKeyFinal = Array(180).fill("");

          // Copiar existente
          projetoExistente.answerKey.forEach((ans: string, idx: number) => {
            if (idx < 180 && ans) answerKeyFinal[idx] = ans;
          });

          // Sobrescrever com novo (apenas posições com valor)
          answerKey.forEach((ans: string, idx: number) => {
            if (idx < 180 && ans) answerKeyFinal[idx] = ans;
          });
        }

        console.log(`[PROJETOS] Resultado: ${studentsFinais.length} alunos após merge`);
      }

      // Mesclar triScores se mergeStudents
      let triScoresFinal = triScores || projetoExistente.triScores;
      let triScoresByAreaFinal = triScoresByArea || projetoExistente.triScoresByArea;

      if (mergeStudents && triScores && projetoExistente.triScores) {
        // Mesclar triScores: combinar existente com novo
        triScoresFinal = { ...projetoExistente.triScores, ...triScores };
        console.log(`[PROJETOS] triScores mesclados: ${Object.keys(triScoresFinal).length} alunos`);
      }

      if (mergeStudents && triScoresByArea && projetoExistente.triScoresByArea) {
        // Mesclar triScoresByArea: para cada aluno, combinar áreas
        triScoresByAreaFinal = { ...projetoExistente.triScoresByArea };
        for (const [studentId, areas] of Object.entries(triScoresByArea)) {
          const existingAreas = triScoresByAreaFinal[studentId] || {};
          triScoresByAreaFinal[studentId] = { ...existingAreas, ...(areas as object) };
        }
        console.log(`[PROJETOS] triScoresByArea mesclados: ${Object.keys(triScoresByAreaFinal).length} alunos`);
      }

      // Atualizar projeto no Supabase
      const { data: updatedData, error: updateError } = await supabaseAdmin
        .from('projetos')
        .update({
          nome: nome || projetoExistente.nome,
          descricao: descricao !== undefined ? descricao : projetoExistente.descricao,
          template: template || projetoExistente.template,
          students: studentsFinais,
          answer_key: answerKeyFinal,
          question_contents: questionContents || projetoExistente.questionContents,
          statistics: statistics || projetoExistente.statistics,
          tri_scores: triScoresFinal,
          tri_scores_by_area: triScoresByAreaFinal,
          // Acumular dias processados: manter true se já estava true OU se está sendo processado agora
          dia1_processado: dia1ProcessadoEnviado || projetoExistente.dia1Processado || template?.name === "ENEM - Dia 1",
          dia2_processado: dia2ProcessadoEnviado || projetoExistente.dia2Processado || template?.name === "ENEM - Dia 2"
        })
        .eq('id', id)
        .select()
        .single();

      if (updateError) {
        console.error("[PROJETOS] Erro Supabase ao atualizar:", updateError);
        throw updateError;
      }

      const projetoAtualizado = projetoDbToFrontend(updatedData);

      res.json({
        success: true,
        projeto: projetoAtualizado,
        message: `Projeto "${projetoAtualizado.nome}" atualizado com sucesso!`
      });
    } catch (error: any) {
      console.error("[PROJETOS] Erro ao atualizar:", error);
      res.status(500).json({
        error: "Erro ao atualizar projeto",
        details: error.message
      });
    }
  });

  // DELETE /api/projetos/:id - Deletar projeto
  // PROTEGIDO: Apenas super_admin pode deletar projetos
  app.delete("/api/projetos/:id", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Primeiro buscar o nome para log
      const { data: projeto, error: fetchError } = await supabaseAdmin
        .from('projetos')
        .select('nome')
        .eq('id', id)
        .single();

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          res.status(404).json({ error: "Projeto não encontrado" });
          return;
        }
        throw fetchError;
      }

      // Deletar projeto
      const { error: deleteError } = await supabaseAdmin
        .from('projetos')
        .delete()
        .eq('id', id);

      if (deleteError) {
        console.error("[PROJETOS] Erro Supabase ao deletar:", deleteError);
        throw deleteError;
      }

      console.log(`[PROJETOS] Projeto "${projeto.nome}" deletado (Supabase)`);

      res.json({
        success: true,
        message: `Projeto "${projeto.nome}" deletado com sucesso!`
      });
    } catch (error: any) {
      console.error("[PROJETOS] Erro ao deletar:", error);
      res.status(500).json({
        error: "Erro ao deletar projeto",
        details: error.message
      });
    }
  });

  // ============================================================================
  // EXAM CONFIGURATION ENDPOINTS - SISTEMA DE PROVAS PERSONALIZÁVEIS
  // ============================================================================

  // POST /api/exam-configurations - Criar nova configuração
  app.post("/api/exam-configurations", async (req: Request, res: Response) => {
    try {
      const config = req.body;

      if (!config.name || config.name.length < 3) {
        res.status(400).json({ error: "Nome deve ter no mínimo 3 caracteres" });
        return;
      }

      if (!config.userId) {
        res.status(400).json({ error: "userId é obrigatório" });
        return;
      }

      if (config.totalQuestions < 5 || config.totalQuestions > 500) {
        res.status(400).json({ error: "Total de questões deve estar entre 5 e 500" });
        return;
      }

      if (config.alternativesCount !== 4 && config.alternativesCount !== 5) {
        res.status(400).json({ error: "Alternativas devem ser 4 ou 5" });
        return;
      }

      if (!Array.isArray(config.disciplines) || config.disciplines.length === 0) {
        res.status(400).json({ error: "Adicione pelo menos uma disciplina" });
        return;
      }

      // Validar coverage de questões
      const allQuestions = new Set<number>();
      for (const disc of config.disciplines) {
        if (disc.startQuestion < 1 || disc.endQuestion < disc.startQuestion) {
          res.status(400).json({ error: `Questões inválidas na disciplina: ${disc.name}` });
          return;
        }
        for (let i = disc.startQuestion; i <= disc.endQuestion; i++) {
          if (allQuestions.has(i)) {
            res.status(400).json({ error: `Sobreposição de questões detectada na disciplina: ${disc.name}` });
            return;
          }
          allQuestions.add(i);
        }
      }

      if (allQuestions.size !== config.totalQuestions) {
        res.status(400).json({
          error: "Disciplinas devem cobrir TODAS as questões sem sobreposição",
          covered: allQuestions.size,
          expected: config.totalQuestions
        });
        return;
      }

      const savedId = await storage.saveExamConfiguration(config);

      res.json({
        success: true,
        id: savedId,
        message: `Configuração "${config.name}" criada com sucesso!`
      });
    } catch (error: any) {
      console.error("[EXAM_CONFIG] Erro ao criar:", error);
      res.status(500).json({
        error: "Erro ao criar configuração",
        details: error.message
      });
    }
  });

  // GET /api/exam-configurations - Listar todas as configurações
  app.get("/api/exam-configurations", async (req: Request, res: Response) => {
    try {
      const configs = await storage.loadExamConfigurations();
      res.json({
        success: true,
        configurations: Object.values(configs),
        total: Object.keys(configs).length
      });
    } catch (error: any) {
      console.error("[EXAM_CONFIG] Erro ao listar:", error);
      res.status(500).json({
        error: "Erro ao listar configurações",
        details: error.message
      });
    }
  });

  // GET /api/exam-configurations/:id - Buscar configuração específica
  app.get("/api/exam-configurations/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const config = await storage.getExamConfiguration(id);

      if (!config) {
        res.status(404).json({ error: "Configuração não encontrada" });
        return;
      }

      res.json({
        success: true,
        configuration: config
      });
    } catch (error: any) {
      console.error("[EXAM_CONFIG] Erro ao buscar:", error);
      res.status(500).json({
        error: "Erro ao buscar configuração",
        details: error.message
      });
    }
  });

  // PUT /api/exam-configurations/:id - Atualizar configuração
  app.put("/api/exam-configurations/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      const existing = await storage.getExamConfiguration(id);
      if (!existing) {
        res.status(404).json({ error: "Configuração não encontrada" });
        return;
      }

      // Se está atualizando disciplinas, validar coverage novamente
      if (updates.disciplines) {
        const allQuestions = new Set<number>();
        const totalQuestions = updates.totalQuestions || existing.totalQuestions;

        for (const disc of updates.disciplines) {
          if (disc.startQuestion < 1 || disc.endQuestion < disc.startQuestion) {
            res.status(400).json({ error: `Questões inválidas na disciplina: ${disc.name}` });
            return;
          }
          for (let i = disc.startQuestion; i <= disc.endQuestion; i++) {
            if (allQuestions.has(i)) {
              res.status(400).json({ error: `Sobreposição de questões detectada` });
              return;
            }
            allQuestions.add(i);
          }
        }

        if (allQuestions.size !== totalQuestions) {
          res.status(400).json({
            error: "Disciplinas devem cobrir TODAS as questões",
            covered: allQuestions.size,
            expected: totalQuestions
          });
          return;
        }
      }

      const updated = await storage.updateExamConfiguration(id, updates);

      res.json({
        success: true,
        configuration: updated,
        message: `Configuração atualizada com sucesso!`
      });
    } catch (error: any) {
      console.error("[EXAM_CONFIG] Erro ao atualizar:", error);
      res.status(500).json({
        error: "Erro ao atualizar configuração",
        details: error.message
      });
    }
  });

  // DELETE /api/exam-configurations/:id - Deletar configuração
  app.delete("/api/exam-configurations/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const existing = await storage.getExamConfiguration(id);
      if (!existing) {
        res.status(404).json({ error: "Configuração não encontrada" });
        return;
      }

      await storage.deleteExamConfiguration(id);

      res.json({
        success: true,
        message: `Configuração "${existing.name}" deletada com sucesso!`
      });
    } catch (error: any) {
      console.error("[EXAM_CONFIG] Erro ao deletar:", error);
      res.status(500).json({
        error: "Erro ao deletar configuração",
        details: error.message
      });
    }
  });

  // GET /api/exam-configurations/user/:userId - Listar configurações do usuário
  app.get("/api/exam-configurations/user/:userId", async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const configs = await storage.listUserExamConfigurations(userId);

      res.json({
        success: true,
        configurations: configs,
        total: configs.length
      });
    } catch (error: any) {
      console.error("[EXAM_CONFIG] Erro ao listar por usuário:", error);
      res.status(500).json({
        error: "Erro ao listar configurações",
        details: error.message
      });
    }
  });

  // =====================================================
  // ADMIN - Importar Alunos (GAB-103)
  // =====================================================

  interface ImportStudentInput {
    matricula: string;
    nome: string;
    turma: string;
    email?: string;
  }

  interface ImportStudentResult {
    matricula: string;
    nome: string;
    turma: string;
    email: string;
    senha: string;
    status: 'created' | 'updated' | 'error';
    message?: string;
  }

  /**
   * Gera senha automática: matrícula + 4 dígitos aleatórios
   */
  function generatePassword(matricula: string): string {
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    return `${matricula}${randomDigits}`;
  }

  /**
   * Gera email baseado na matrícula se não fornecido
   */
  function generateEmail(matricula: string, schoolSlug: string = 'escola'): string {
    return `${matricula}@${schoolSlug}.gabaritai.com`;
  }

  // POST /api/admin/import-students - Importar alunos em lote COM CONTA AUTH
  // 🔒 PROTECTED: Requer autenticação + role admin
  // ✅ v3 - 2025-01-14 - Cria Auth + profiles + students com senha padrão
  // Alunos devem trocar senha no primeiro acesso (must_change_password)
  app.post("/api/admin/import-students", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    const DEFAULT_PASSWORD = 'escola123';
    console.log("[IMPORT v3] Iniciando importação COM criação de conta Auth");

    try {
      const { students, schoolId } = req.body as {
        students: ImportStudentInput[];
        schoolId?: string;
      };

      if (!students || !Array.isArray(students) || students.length === 0) {
        res.status(400).json({
          error: "Lista de alunos é obrigatória",
          details: "Envie um array de objetos com matricula, nome, turma"
        });
        return;
      }

      if (!schoolId) {
        res.status(400).json({
          error: "schoolId é obrigatório",
          details: "Especifique a escola para importar os alunos"
        });
        return;
      }

      console.log(`[IMPORT] Importando ${students.length} aluno(s) para escola ${schoolId}...`);

      const results: ImportStudentResult[] = [];
      let created = 0;
      let updated = 0;
      let errors = 0;

      for (const student of students) {
        const { matricula, nome, turma } = student;

        // Validação básica
        if (!matricula || !nome) {
          results.push({
            matricula: matricula || 'N/A',
            nome: nome || 'N/A',
            turma: turma || 'N/A',
            email: '',
            senha: '',
            status: 'error',
            message: 'Campos obrigatórios faltando (matricula, nome)'
          });
          errors++;
          continue;
        }

        const email = `${matricula}@escola.gabaritai.com`;

        try {
          // Verificar se já existe aluno na tabela students
          const { data: existingStudent } = await supabaseAdmin
            .from('students')
            .select('id, profile_id')
            .eq('school_id', schoolId)
            .eq('matricula', matricula)
            .maybeSingle();

          // Verificar se já existe profile com este email
          const { data: existingProfile } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('email', email)
            .maybeSingle();

          if (existingStudent && existingStudent.profile_id) {
            // Aluno já existe COM conta Auth - apenas atualizar dados
            await supabaseAdmin.from('students').update({
              name: nome,
              turma: turma || null
            }).eq('id', existingStudent.id);

            await supabaseAdmin.from('profiles').update({
              name: nome,
              turma: turma || null
            }).eq('id', existingStudent.profile_id);

            results.push({
              matricula,
              nome,
              turma: turma || '',
              email,
              senha: '(mantida)',
              status: 'updated',
              message: 'Dados atualizados (conta Auth existente)'
            });
            updated++;
          } else if (existingProfile) {
            // Profile existe mas students não está linkado
            if (existingStudent) {
              await supabaseAdmin.from('students').update({
                name: nome,
                turma: turma || null,
                profile_id: existingProfile.id
              }).eq('id', existingStudent.id);
            } else {
              await supabaseAdmin.from('students').insert({
                school_id: schoolId,
                matricula,
                name: nome,
                turma: turma || null,
                profile_id: existingProfile.id
              });
            }

            results.push({
              matricula,
              nome,
              turma: turma || '',
              email,
              senha: '(conta existente)',
              status: 'updated',
              message: 'Vinculado a conta existente'
            });
            updated++;
          } else {
            // Criar nova conta Auth + profile + students
            const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
              email,
              password: DEFAULT_PASSWORD,
              email_confirm: true,
              user_metadata: {
                must_change_password: true,
                name: nome,
                role: 'student'
              }
            });

            if (authError) {
              throw new Error(`Erro ao criar conta Auth: ${authError.message}`);
            }

            // Criar profile
            const { error: profileError } = await supabaseAdmin.from('profiles').insert({
              id: authUser.user.id,
              email,
              name: nome,
              role: 'student',
              school_id: schoolId,
              student_number: matricula,
              turma: turma || null,
              must_change_password: true
            });

            if (profileError) {
              console.warn(`[IMPORT] Profile insert warning for ${matricula}:`, profileError.message);
            }

            // Criar/atualizar students com profile_id
            if (existingStudent) {
              await supabaseAdmin.from('students').update({
                name: nome,
                turma: turma || null,
                profile_id: authUser.user.id
              }).eq('id', existingStudent.id);
            } else {
              await supabaseAdmin.from('students').insert({
                school_id: schoolId,
                matricula,
                name: nome,
                turma: turma || null,
                profile_id: authUser.user.id
              });
            }

            console.log(`[IMPORT] ✓ ${nome} (${matricula}) - conta criada`);

            results.push({
              matricula,
              nome,
              turma: turma || '',
              email,
              senha: DEFAULT_PASSWORD,
              status: 'created',
              message: 'Conta criada com sucesso'
            });
            created++;
          }
        } catch (error: any) {
          console.error(`[IMPORT] Erro ${matricula}:`, error.message);
          results.push({
            matricula,
            nome,
            turma: turma || '',
            email,
            senha: '',
            status: 'error',
            message: error.message
          });
          errors++;
        }
      }

      console.log(`[IMPORT] ✅ Concluído: ${created} criados, ${updated} atualizados, ${errors} erros`);

      res.json({
        success: errors === 0,
        summary: {
          total: students.length,
          created,
          updated,
          errors
        },
        results,
        info: {
          message: "Alunos importados com contas de acesso!",
          defaultPassword: DEFAULT_PASSWORD,
          loginInstructions: "Alunos devem fazer login com email {matricula}@escola.gabaritai.com e trocar a senha no primeiro acesso"
        }
      });
    } catch (error: any) {
      console.error("[IMPORT] Erro geral:", error);
      res.status(500).json({
        error: "Erro ao importar alunos",
        details: error.message
      });
    }
  });

  // GET /api/admin/export-credentials - Exportar credenciais dos alunos
  // 🔒 PROTECTED: Requer autenticação + role admin
  app.get("/api/admin/export-credentials", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    try {
      const { turma, school_id } = req.query;

      let query = supabaseAdmin
        .from("profiles")
        .select("name, student_number, email, turma")
        .eq("role", "student")
        .order("turma")
        .order("name");

      if (turma && typeof turma === 'string') {
        query = query.eq("turma", turma);
      }

      if (school_id && typeof school_id === 'string') {
        query = query.eq("school_id", school_id);
      }

      const { data: students, error } = await query;

      if (error) throw error;

      // Gerar CSV
      const csvHeader = "Nome,Matrícula,Email,Turma,Senha Padrão\n";
      const csvRows = students?.map(s =>
        `"${s.name || ''}","${s.student_number || ''}","${s.email || ''}","${s.turma || ''}","${s.student_number}1234"`
      ).join("\n") || "";

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=credenciais_alunos.csv");
      res.send(csvHeader + csvRows);

    } catch (error: any) {
      console.error("[EXPORT_CREDENTIALS] Erro:", error);
      res.status(500).json({ error: "Erro ao exportar credenciais", details: error.message });
    }
  });

  // GET /api/admin/students - Listar alunos de uma escola (tabela students)
  // 🔒 PROTECTED: Requer autenticação + role admin
  app.get("/api/admin/students", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    try {
      const { school_id, turma, search, page = '1', limit = '50' } = req.query;

      if (!school_id) {
        res.status(400).json({ error: "school_id é obrigatório" });
        return;
      }

      let query = supabaseAdmin
        .from('students')
        .select('*', { count: 'exact' })
        .eq('school_id', school_id as string)
        .order('name', { ascending: true });

      // Filtro por turma
      if (turma && typeof turma === 'string' && turma !== 'all') {
        query = query.eq('turma', turma);
      }

      // Busca por nome ou matrícula
      if (search && typeof search === 'string') {
        query = query.or(`name.ilike.%${search}%,matricula.ilike.%${search}%`);
      }

      // Paginação
      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const offset = (pageNum - 1) * limitNum;

      query = query.range(offset, offset + limitNum - 1);

      const { data, error, count } = await query;

      if (error) {
        throw new Error(`Erro ao buscar alunos: ${error.message}`);
      }

      // Buscar lista de turmas únicas para o filtro
      const { data: turmasData } = await supabaseAdmin
        .from('students')
        .select('turma')
        .eq('school_id', school_id as string)
        .not('turma', 'is', null);

      const turmas = [...new Set(turmasData?.map(t => t.turma).filter(Boolean))].sort();

      // Mapear para formato esperado pelo frontend (student_number = matricula)
      const students = (data || []).map(s => ({
        ...s,
        student_number: s.matricula,
        email: `${s.matricula}@escola.gabaritai.com`
      }));

      res.json({
        success: true,
        students,
        pagination: {
          total: count || 0,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil((count || 0) / limitNum)
        },
        turmas
      });
    } catch (error: any) {
      console.error("[GET STUDENTS]", error);
      res.status(500).json({
        error: "Erro ao buscar alunos",
        details: error.message
      });
    }
  });

  // GET /api/admin/students/:schoolId/turmas - Listar turmas de uma escola
  // 🔒 PROTECTED: Requer autenticação + role admin
  app.get("/api/admin/students/:schoolId/turmas", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    try {
      const { schoolId } = req.params;

      const { data, error } = await supabaseAdmin
        .from('students')
        .select('turma')
        .eq('school_id', schoolId)
        .not('turma', 'is', null);

      if (error) {
        throw new Error(`Erro ao buscar turmas: ${error.message}`);
      }

      // Extrair turmas únicas
      const turmas = [...new Set(data?.map(s => s.turma).filter(Boolean))].sort();

      res.json({
        success: true,
        turmas
      });
    } catch (error: any) {
      console.error("[GET TURMAS]", error);
      res.status(500).json({
        error: "Erro ao buscar turmas",
        details: error.message
      });
    }
  });

  // DELETE /api/admin/students/:id - Deletar aluno (cascade: Auth + profiles + students)
  // 🔒 PROTECTED: Requer autenticação + role admin
  // ✅ v2 - 2025-01-14 - Cascade delete através de todas as tabelas
  app.delete("/api/admin/students/:id", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // 1. Tentar buscar na tabela students primeiro
      const { data: studentRecord } = await supabaseAdmin
        .from('students')
        .select('id, matricula, name, profile_id')
        .eq('id', id)
        .maybeSingle();

      // 2. Se não encontrou em students, pode ser um ID de profile
      if (!studentRecord) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('id, name, student_number, email')
          .eq('id', id)
          .eq('role', 'student')
          .maybeSingle();

        if (!profile) {
          return res.status(404).json({ error: "Aluno não encontrado" });
        }

        // Deletar Auth user
        try {
          await supabaseAdmin.auth.admin.deleteUser(id);
          console.log(`[DELETE] Auth user ${id} removido`);
        } catch (authErr: any) {
          console.warn(`[DELETE] Auth warning:`, authErr.message);
        }

        // Deletar profile (students será atualizado via FK SET NULL)
        await supabaseAdmin.from('profiles').delete().eq('id', id);

        // Deletar registros em students que apontavam para este profile
        await supabaseAdmin.from('students').delete().eq('profile_id', id);

        console.log(`[DELETE] Aluno ${profile.name} (profile) removido completamente`);
        return res.json({
          success: true,
          message: `Aluno ${profile.name} removido completamente`
        });
      }

      // 3. Encontrou em students - verificar se tem profile_id
      if (studentRecord.profile_id) {
        // Deletar Auth user primeiro
        try {
          await supabaseAdmin.auth.admin.deleteUser(studentRecord.profile_id);
          console.log(`[DELETE] Auth user ${studentRecord.profile_id} removido`);
        } catch (authErr: any) {
          console.warn(`[DELETE] Auth warning:`, authErr.message);
        }

        // Deletar profile
        try {
          await supabaseAdmin.from('profiles').delete().eq('id', studentRecord.profile_id);
          console.log(`[DELETE] Profile ${studentRecord.profile_id} removido`);
        } catch (profileErr: any) {
          console.warn(`[DELETE] Profile warning:`, profileErr.message);
        }
      }

      // 4. Deletar da tabela students
      const { error: deleteError } = await supabaseAdmin
        .from('students')
        .delete()
        .eq('id', id);

      if (deleteError) {
        throw new Error(`Erro ao deletar students: ${deleteError.message}`);
      }

      console.log(`[DELETE] Aluno ${studentRecord.name} (${studentRecord.matricula}) removido completamente`);

      res.json({
        success: true,
        message: `Aluno ${studentRecord.name} removido completamente`
      });
    } catch (error: any) {
      console.error("[DELETE STUDENT]", error);
      res.status(500).json({
        error: "Erro ao deletar aluno",
        details: error.message
      });
    }
  });

  // POST /api/admin/students/:id/reset-password - Resetar senha do aluno (Auth)
  // 🔒 PROTECTED: Requer autenticação + role admin
  // ✅ v2 - 2025-01-14 - Cria Auth account se aluno não tiver (importados via CSV)
  app.post("/api/admin/students/:id/reset-password", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    const DEFAULT_PASSWORD = 'escola123';

    try {
      const { id } = req.params;

      // Primeiro: tentar encontrar em profiles (aluno já tem Auth)
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, name, student_number, email')
        .eq('id', id)
        .single();

      if (profile) {
        // Aluno já tem Auth - apenas resetar senha
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, {
          password: DEFAULT_PASSWORD,
          user_metadata: {
            must_change_password: true
          }
        });

        if (authError) {
          throw new Error(`Erro ao resetar senha: ${authError.message}`);
        }

        // Atualizar flag no profiles também
        await supabaseAdmin
          .from('profiles')
          .update({ must_change_password: true })
          .eq('id', id);

        console.log(`[RESET] Senha resetada para ${profile.name} (${profile.student_number})`);

        res.json({
          success: true,
          message: `Senha de ${profile.name} resetada para ${DEFAULT_PASSWORD}`,
          student: {
            id,
            name: profile.name,
            student_number: profile.student_number,
            email: profile.email
          },
          newPassword: DEFAULT_PASSWORD,
          mustChangePassword: true
        });
        return;
      }

      // Segundo: buscar em students (aluno importado via CSV sem Auth)
      const { data: student } = await supabaseAdmin
        .from('students')
        .select('id, nome, matricula, turma, escola_id, profile_id')
        .eq('id', id)
        .single();

      if (!student) {
        res.status(404).json({ error: "Aluno não encontrado em nenhuma tabela" });
        return;
      }

      // Se já tem profile_id, usar esse ID para resetar
      if (student.profile_id) {
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(student.profile_id, {
          password: DEFAULT_PASSWORD,
          user_metadata: {
            must_change_password: true
          }
        });

        if (authError) {
          throw new Error(`Erro ao resetar senha: ${authError.message}`);
        }

        await supabaseAdmin
          .from('profiles')
          .update({ must_change_password: true })
          .eq('id', student.profile_id);

        console.log(`[RESET] Senha resetada para ${student.nome} (${student.matricula}) via profile_id`);

        res.json({
          success: true,
          message: `Senha de ${student.nome} resetada para ${DEFAULT_PASSWORD}`,
          student: {
            id: student.profile_id,
            name: student.nome,
            student_number: student.matricula
          },
          newPassword: DEFAULT_PASSWORD,
          mustChangePassword: true
        });
        return;
      }

      // Terceiro: Aluno sem Auth - CRIAR conta Auth + profile + linkar
      console.log(`[RESET] Aluno ${student.nome} sem Auth - criando conta...`);

      // Gerar email único para o aluno
      const emailBase = student.matricula.toLowerCase().replace(/[^a-z0-9]/g, '');
      const email = `${emailBase}@aluno.gabaritai.com`;

      // Criar usuário no Supabase Auth
      const { data: authUser, error: authCreateError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: {
          must_change_password: true,
          name: student.nome,
          role: 'student'
        }
      });

      if (authCreateError) {
        throw new Error(`Erro ao criar conta Auth: ${authCreateError.message}`);
      }

      // Criar profile para o usuário
      const { data: newProfile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: authUser.user.id,
          email,
          name: student.nome,
          role: 'student',
          escola_id: student.escola_id,
          student_number: student.matricula,
          must_change_password: true
        })
        .select()
        .single();

      if (profileError) {
        // Rollback: deletar Auth user se profile falhou
        await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
        throw new Error(`Erro ao criar profile: ${profileError.message}`);
      }

      // Linkar profile_id no students
      await supabaseAdmin
        .from('students')
        .update({ profile_id: authUser.user.id })
        .eq('id', student.id);

      console.log(`[RESET] Conta Auth criada para ${student.nome} (${email})`);

      res.json({
        success: true,
        message: `Conta criada para ${student.nome} com senha ${DEFAULT_PASSWORD}`,
        student: {
          id: authUser.user.id,
          name: student.nome,
          student_number: student.matricula,
          email
        },
        newPassword: DEFAULT_PASSWORD,
        mustChangePassword: true,
        accountCreated: true
      });
    } catch (error: any) {
      console.error("[RESET] Erro:", error);
      res.status(500).json({
        error: "Erro ao resetar senha",
        details: error.message
      });
    }
  });

  // POST /api/admin/students/reset-all-passwords - Resetar senha de TODOS os alunos
  // 🔒 PROTECTED: Requer autenticação + role admin
  // ✅ v2 - 2025-01-14 - Usar senha padrão 'escola123'
  app.post("/api/admin/students/reset-all-passwords", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    const DEFAULT_PASSWORD = 'escola123';
    const BATCH_SIZE = 5;
    const BATCH_DELAY_MS = 1500;

    try {
      const { turma, schoolId } = req.body as { turma?: string; schoolId?: string };

      // Buscar alunos (filtrados por turma/escola se especificado)
      let query = supabaseAdmin
        .from('profiles')
        .select('id, name, student_number')
        .eq('role', 'student');

      if (turma) query = query.eq('turma', turma);
      if (schoolId) query = query.eq('school_id', schoolId);

      const { data: students, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      if (!students || students.length === 0) {
        res.status(404).json({ error: "Nenhum aluno encontrado" });
        return;
      }

      console.log(`[RESET-ALL] Resetando senha de ${students.length} aluno(s)...`);

      let success = 0;
      let errors = 0;
      const failures: string[] = [];

      // Processar em lotes
      for (let i = 0; i < students.length; i += BATCH_SIZE) {
        const batch = students.slice(i, i + BATCH_SIZE);

        const results = await Promise.all(batch.map(async (student) => {
          try {
            await supabaseAdmin.auth.admin.updateUserById(student.id, {
              password: DEFAULT_PASSWORD,
              user_metadata: { must_change_password: true }
            });
            return { success: true };
          } catch (e: any) {
            return { success: false, error: `${student.student_number}: ${e.message}` };
          }
        }));

        results.forEach(r => {
          if (r.success) success++;
          else {
            errors++;
            if ('error' in r) failures.push(r.error);
          }
        });

        if (i + BATCH_SIZE < students.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      console.log(`[RESET-ALL] ✅ Concluído: ${success} resetados, ${errors} erros`);

      res.json({
        success: errors === 0,
        summary: {
          total: students.length,
          success,
          errors
        },
        newPassword: DEFAULT_PASSWORD,
        failures: failures.length > 0 ? failures : undefined
      });
    } catch (error: any) {
      console.error("[RESET-ALL] Erro:", error);
      res.status(500).json({
        error: "Erro ao resetar senhas",
        details: error.message
      });
    }
  });

  // GET /api/admin/students-legacy - REMOVIDO: Usar o novo /api/admin/students
  // Este endpoint foi substituído pelo novo que usa a tabela 'students'

  // POST /api/admin/reset-password - Resetar senha do aluno (endpoint legado)
  // 🔒 PROTECTED: Requer autenticação + role admin
  // ✅ v2 - 2025-01-14 - Usar senha padrão 'escola123' com must_change_password
  app.post("/api/admin/reset-password", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    const DEFAULT_PASSWORD = 'escola123';

    try {
      const { studentId } = req.body;

      if (!studentId) {
        res.status(400).json({ error: "ID do aluno é obrigatório" });
        return;
      }

      // Atualizar senha no Supabase Auth
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        studentId,
        {
          password: DEFAULT_PASSWORD,
          user_metadata: { must_change_password: true }
        }
      );

      if (authError) {
        throw new Error(`Erro ao resetar senha: ${authError.message}`);
      }

      // Atualizar flag no profiles também
      await supabaseAdmin
        .from('profiles')
        .update({ must_change_password: true })
        .eq('id', studentId);

      console.log(`[RESET-PWD] Senha resetada para aluno ${studentId}`);

      res.json({
        success: true,
        novaSenha: DEFAULT_PASSWORD,
        message: "Senha resetada com sucesso",
        mustChangePassword: true
      });
    } catch (error: any) {
      console.error("[RESET-PWD] Erro:", error);
      res.status(500).json({
        error: "Erro ao resetar senha",
        details: error.message
      });
    }
  });

  // ============================================================================
  // TURMAS - Gestão e Geração de Gabaritos
  // ============================================================================

  // GET /api/admin/turmas - Listar turmas com contagem de alunos (tabela students)
  // 🔒 PROTECTED: Requer autenticação + role admin
  app.get("/api/admin/turmas", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    try {
      const { school_id } = req.query;

      if (!school_id) {
        res.status(400).json({ error: "school_id é obrigatório" });
        return;
      }

      // Buscar todas as turmas distintas com contagem da tabela students
      const { data: students, error } = await supabaseAdmin
        .from('students')
        .select('turma')
        .eq('school_id', school_id as string)
        .not('turma', 'is', null);

      if (error) throw error;

      // Agrupar por turma e contar
      const turmaMap = new Map<string, number>();
      students?.forEach(s => {
        if (s.turma) {
          turmaMap.set(s.turma, (turmaMap.get(s.turma) || 0) + 1);
        }
      });

      const turmas = Array.from(turmaMap.entries())
        .map(([nome, count]) => ({ nome, alunosCount: count }))
        .sort((a, b) => a.nome.localeCompare(b.nome));

      res.json({
        success: true,
        turmas,
        total: turmas.length
      });
    } catch (error: any) {
      console.error("[TURMAS] Erro:", error);
      res.status(500).json({ error: "Erro ao listar turmas", details: error.message });
    }
  });

  // GET /api/admin/turmas/:nome/alunos - Listar alunos de uma turma (tabela students)
  // 🔒 PROTECTED: Requer autenticação + role admin
  app.get("/api/admin/turmas/:nome/alunos", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    try {
      const turma = decodeURIComponent(req.params.nome);
      const { school_id } = req.query;

      if (!school_id) {
        res.status(400).json({ error: "school_id é obrigatório" });
        return;
      }

      const { data: alunos, error } = await supabaseAdmin
        .from('students')
        .select('id, name, matricula, turma')
        .eq('school_id', school_id as string)
        .eq('turma', turma)
        .order('name');

      if (error) throw error;

      // Mapear para formato esperado
      const alunosFormatted = (alunos || []).map(a => ({
        ...a,
        student_number: a.matricula,
        email: `${a.matricula}@escola.gabaritai.com`
      }));

      res.json({
        success: true,
        turma,
        alunos: alunosFormatted,
        total: alunos?.length || 0
      });
    } catch (error: any) {
      console.error("[TURMAS] Erro ao listar alunos:", error);
      res.status(500).json({ error: "Erro ao listar alunos da turma", details: error.message });
    }
  });

  // POST /api/admin/turmas - Criar nova turma (tabela students)
  // 🔒 PROTECTED: Requer autenticação + role admin
  app.post("/api/admin/turmas", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    try {
      const { nome, school_id } = req.body;

      if (!nome) {
        res.status(400).json({ error: "Nome da turma é obrigatório" });
        return;
      }

      if (!school_id) {
        res.status(400).json({ error: "school_id é obrigatório" });
        return;
      }

      // Verificar se já existe alunos com essa turma na escola
      const { data: existing, error: checkError } = await supabaseAdmin
        .from('students')
        .select('id')
        .eq('school_id', school_id)
        .eq('turma', nome)
        .limit(1);

      if (checkError) throw checkError;

      if (existing && existing.length > 0) {
        res.status(400).json({ error: "Turma já existe" });
        return;
      }

      // Turmas são criadas implicitamente quando alunos são cadastrados
      // Retornar sucesso para indicar que a turma pode ser usada
      res.json({
        success: true,
        message: "Turma criada. Adicione alunos para ativar a turma.",
        turma: { nome }
      });
    } catch (error: any) {
      console.error("[TURMAS] Erro ao criar turma:", error);
      res.status(500).json({ error: "Erro ao criar turma", details: error.message });
    }
  });

  // PUT /api/admin/turmas/:nome - Renomear turma (tabela students)
  // 🔒 PROTECTED: Requer autenticação + role admin
  app.put("/api/admin/turmas/:nome", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    try {
      const turmaAtual = decodeURIComponent(req.params.nome);
      const { novoNome, school_id } = req.body;

      if (!novoNome) {
        res.status(400).json({ error: "Novo nome da turma é obrigatório" });
        return;
      }

      if (!school_id) {
        res.status(400).json({ error: "school_id é obrigatório" });
        return;
      }

      // Atualizar todos os alunos da turma para o novo nome
      const { data, error } = await supabaseAdmin
        .from('students')
        .update({ turma: novoNome })
        .eq('turma', turmaAtual)
        .eq('school_id', school_id)
        .select();

      if (error) throw error;

      res.json({
        success: true,
        message: `Turma renomeada de "${turmaAtual}" para "${novoNome}"`,
        alunosAtualizados: data?.length || 0
      });
    } catch (error: any) {
      console.error("[TURMAS] Erro ao renomear turma:", error);
      res.status(500).json({ error: "Erro ao renomear turma", details: error.message });
    }
  });

  // DELETE /api/admin/turmas/:nome - Excluir turma (remove alunos da turma)
  // 🔒 PROTECTED: Requer autenticação + role admin
  app.delete("/api/admin/turmas/:nome", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    try {
      const turma = decodeURIComponent(req.params.nome);
      const school_id = req.query.school_id as string;

      if (!school_id) {
        res.status(400).json({ error: "school_id é obrigatório" });
        return;
      }

      // Contar alunos na turma
      const { count } = await supabaseAdmin
        .from('students')
        .select('*', { count: 'exact', head: true })
        .eq('turma', turma)
        .eq('school_id', school_id);

      if (count && count > 0) {
        res.status(400).json({
          error: `Não é possível excluir turma com ${count} aluno(s). Remova ou mova os alunos primeiro.`
        });
        return;
      }

      res.json({
        success: true,
        message: `Turma "${turma}" excluída com sucesso`
      });
    } catch (error: any) {
      console.error("[TURMAS] Erro ao excluir turma:", error);
      res.status(500).json({ error: "Erro ao excluir turma", details: error.message });
    }
  });

  // POST /api/admin/students - Criar um único aluno (tabela students)
  // 🔒 PROTECTED: Requer autenticação + role admin
  app.post("/api/admin/students", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    try {
      const { nome, matricula, turma, school_id } = req.body;

      if (!nome || !matricula) {
        res.status(400).json({ error: "Nome e matrícula são obrigatórios" });
        return;
      }

      if (!school_id) {
        res.status(400).json({ error: "school_id é obrigatório" });
        return;
      }

      // Verificar se matrícula já existe na escola
      const { data: existing, error: checkError } = await supabaseAdmin
        .from('students')
        .select('id')
        .eq('school_id', school_id)
        .eq('matricula', matricula)
        .limit(1);

      if (checkError) throw checkError;

      if (existing && existing.length > 0) {
        res.status(400).json({ error: "Matrícula já cadastrada nesta escola" });
        return;
      }

      // Criar aluno na tabela students (sem Auth)
      const { data: newStudent, error: insertError } = await supabaseAdmin
        .from('students')
        .insert({
          school_id,
          matricula,
          name: nome,
          turma: turma || null
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(`Erro ao criar aluno: ${insertError.message}`);
      }

      res.json({
        success: true,
        aluno: {
          id: newStudent.id,
          nome: newStudent.name,
          matricula: newStudent.matricula,
          turma: newStudent.turma,
          email: `${newStudent.matricula}@escola.gabaritai.com`
        }
      });
    } catch (error: any) {
      console.error("[STUDENTS] Erro ao criar aluno:", error);
      res.status(500).json({ error: error.message || "Erro ao criar aluno" });
    }
  });

  // POST /api/admin/generate-gabaritos - Gerar PDFs de gabaritos para turma (tabela students)
  // 🔒 PROTECTED: Requer autenticação + role admin
  // 🆕 Usa template XTRI com marcadores de canto para OMR e QR codes
  app.post("/api/admin/generate-gabaritos", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    try {
      const { turma, alunoIds, dia, school_id } = req.body;

      if (!school_id) {
        res.status(400).json({ error: "school_id é obrigatório" });
        return;
      }

      if (!turma && (!alunoIds || alunoIds.length === 0)) {
        res.status(400).json({ error: "Informe a turma ou lista de alunos" });
        return;
      }

      // Buscar alunos da tabela students
      let query = supabaseAdmin
        .from('students')
        .select('id, name, matricula, turma, sheet_code')
        .eq('school_id', school_id)
        .order('name');

      if (alunoIds && alunoIds.length > 0) {
        query = query.in('id', alunoIds);
      } else if (turma) {
        query = query.eq('turma', turma);
      }

      const { data: alunos, error } = await query;

      if (error) throw error;
      if (!alunos || alunos.length === 0) {
        res.status(404).json({ error: "Nenhum aluno encontrado" });
        return;
      }

      console.log(`[GABARITOS] Gerando ${alunos.length} gabaritos XTRI para turma: ${turma || 'selecionados'}`);

      // Converter alunos para formato esperado pelo generateBatchPDF
      // Usa sheet_code existente do banco, gera novo apenas se não tiver
      const studentsForPdf = alunos.map(aluno => ({
        batch_id: 'admin-generated',
        enrollment_code: aluno.matricula || null,
        student_name: aluno.name || 'Sem nome',
        class_name: aluno.turma || null,
        sheet_code: aluno.sheet_code || generateSheetCode(),
      }));

      // Salvar sheet_codes gerados de volta no banco (para alunos que não tinham)
      const alunosSemCodigo = alunos.filter((a, i) => !a.sheet_code && studentsForPdf[i].sheet_code);
      if (alunosSemCodigo.length > 0) {
        console.log(`[GABARITOS] Salvando ${alunosSemCodigo.length} sheet_codes novos no banco`);
        for (let i = 0; i < alunos.length; i++) {
          if (!alunos[i].sheet_code && studentsForPdf[i].sheet_code) {
            const { error: updateError } = await supabaseAdmin
              .from('students')
              .update({ sheet_code: studentsForPdf[i].sheet_code })
              .eq('id', alunos[i].id);
            if (updateError) {
              console.error(`[GABARITOS] Erro ao salvar sheet_code para ${alunos[i].name}:`, updateError);
            }
          }
        }
      }

      // Gerar PDF com template XTRI (com marcadores OMR, QR codes, letras nas bolhas)
      const examName = dia ? `Dia ${dia}` : 'Simulado ENEM';
      const pdfBuffer = await generateBatchPDF(studentsForPdf, examName);

      console.log(`[GABARITOS] PDF XTRI gerado com ${alunos.length} páginas`);

      // Gerar CSV com mapeamento matrícula -> sheet_code
      const codesMapping = studentsForPdf.map(s => ({
        matricula: s.enrollment_code,
        nome: s.student_name,
        turma: s.class_name,
        sheet_code: s.sheet_code,
      }));

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="gabaritos_${turma || 'selecionados'}.pdf"`);
      res.setHeader('X-Sheet-Codes', JSON.stringify(codesMapping));
      res.send(pdfBuffer);

    } catch (error: any) {
      console.error("[GABARITOS] Erro:", error);
      res.status(500).json({ error: "Erro ao gerar gabaritos", details: error.message });
    }
  });

  // ============================================================================
  // GAB-106: SALVAR RESPOSTAS DOS ALUNOS (com vinculação por matrícula)
  // ============================================================================

  // POST /api/student-answers - Salvar respostas de um aluno
  app.post("/api/student-answers", async (req: Request, res: Response) => {
    try {
      const {
        exam_id,
        school_id,
        student_name,
        student_number,
        turma,
        answers,
        score,
        correct_answers,
        wrong_answers,
        blank_answers,
        tri_theta,
        tri_score,
        tri_lc,
        tri_ch,
        tri_cn,
        tri_mt,
        confidence
      } = req.body;

      // Validações obrigatórias
      if (!exam_id || !school_id || !student_name || !answers) {
        return res.status(400).json({
          error: "Dados obrigatórios faltando",
          required: ["exam_id", "school_id", "student_name", "answers"]
        });
      }

      console.log(`[STUDENT_ANSWERS] Salvando resultado para: ${student_name} (${student_number || 'sem matrícula'})`);

      // GAB-106: Buscar student_id pelo student_number se fornecido
      let student_id: string | null = null;

      if (student_number) {
        // Busca por student_number (não filtra por school_id porque profiles podem ter school_id null)
        const { data: profile, error: profileError } = await supabaseAdmin
          .from("profiles")
          .select("id, name, school_id")
          .eq("student_number", student_number)
          .single();

        if (profileError) {
          console.log(`[STUDENT_ANSWERS] Erro ao buscar perfil: ${profileError.message}`);
        }

        if (profile) {
          student_id = profile.id;
          console.log(`[STUDENT_ANSWERS] Aluno encontrado no profiles: ${student_id} (${profile.name})`);
        } else {
          console.log(`[STUDENT_ANSWERS] Aluno não cadastrado: ${student_number} - salvando sem vinculação`);
        }
      }

      // Upsert - atualiza se existir (mesmo exam_id + student_number)
      const { data, error } = await supabaseAdmin
        .from("student_answers")
        .upsert({
          exam_id,
          student_id,
          school_id,
          student_name,
          student_number,
          turma,
          answers,
          score,
          correct_answers,
          wrong_answers,
          blank_answers,
          tri_theta,
          tri_score,
          tri_lc,
          tri_ch,
          tri_cn,
          tri_mt,
          confidence
        }, {
          onConflict: "exam_id,student_number"
        })
        .select()
        .single();

      if (error) {
        console.error("[STUDENT_ANSWERS] Erro ao salvar:", error);
        return res.status(500).json({
          error: "Erro ao salvar resposta",
          details: error.message
        });
      }

      res.json({
        success: true,
        message: student_id ? "Resultado salvo e vinculado ao aluno" : "Resultado salvo (aluno não cadastrado)",
        data,
        linked: !!student_id
      });

    } catch (error: any) {
      console.error("[STUDENT_ANSWERS] Erro:", error);
      res.status(500).json({
        error: "Erro ao salvar resposta do aluno",
        details: error.message
      });
    }
  });

  // POST /api/student-answers/batch - Salvar respostas de múltiplos alunos
  app.post("/api/student-answers/batch", async (req: Request, res: Response) => {
    try {
      const { exam_id, school_id, students } = req.body;

      if (!exam_id || !school_id || !students || !Array.isArray(students)) {
        return res.status(400).json({
          error: "Dados obrigatórios faltando",
          required: ["exam_id", "school_id", "students (array)"]
        });
      }

      console.log(`[STUDENT_ANSWERS_BATCH] Salvando ${students.length} resultados`);

      // Buscar todos os profiles de uma vez para otimizar (não filtra por school_id porque profiles podem ter school_id null)
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from("profiles")
        .select("id, student_number")
        .eq("role", "student");

      if (profilesError) {
        console.log(`[STUDENT_ANSWERS_BATCH] Erro ao buscar profiles: ${profilesError.message}`);
      }

      // Criar mapa de student_number -> id para lookup rápido
      const profileMap = new Map<string, string>();
      profiles?.forEach(p => {
        if (p.student_number) {
          profileMap.set(p.student_number, p.id);
        }
      });

      console.log(`[STUDENT_ANSWERS_BATCH] ${profileMap.size} alunos cadastrados`);

      // Preparar dados com student_id vinculado
      const answersToInsert = students.map(s => ({
        exam_id,
        school_id,
        student_id: s.student_number ? (profileMap.get(s.student_number) || null) : null,
        student_name: s.student_name,
        student_number: s.student_number,
        turma: s.turma,
        answers: s.answers,
        score: s.score,
        correct_answers: s.correct_answers,
        wrong_answers: s.wrong_answers,
        blank_answers: s.blank_answers,
        tri_theta: s.tri_theta,
        tri_score: s.tri_score,
        tri_lc: s.tri_lc,
        tri_ch: s.tri_ch,
        tri_cn: s.tri_cn,
        tri_mt: s.tri_mt,
        confidence: s.confidence
      }));

      // Contar vinculações
      const linkedCount = answersToInsert.filter(a => a.student_id).length;

      // Upsert em batch
      const { data, error } = await supabaseAdmin
        .from("student_answers")
        .upsert(answersToInsert, {
          onConflict: "exam_id,student_number"
        })
        .select();

      if (error) {
        console.error("[STUDENT_ANSWERS_BATCH] Erro:", error);
        return res.status(500).json({
          error: "Erro ao salvar respostas em lote",
          details: error.message
        });
      }

      console.log(`[STUDENT_ANSWERS_BATCH] Salvos ${data?.length} resultados, ${linkedCount} vinculados`);

      res.json({
        success: true,
        message: `${data?.length || 0} resultados salvos, ${linkedCount} vinculados a alunos cadastrados`,
        total: data?.length || 0,
        linked: linkedCount,
        unlinked: (data?.length || 0) - linkedCount
      });

    } catch (error: any) {
      console.error("[STUDENT_ANSWERS_BATCH] Erro:", error);
      res.status(500).json({
        error: "Erro ao salvar respostas em lote",
        details: error.message
      });
    }
  });

  // GET /api/student-answers/:studentId - Buscar resultados de um aluno
  app.get("/api/student-answers/:studentId", async (req: Request, res: Response) => {
    try {
      const { studentId } = req.params;

      // Tentar buscar por student_id primeiro
      let { data, error } = await supabaseAdmin
        .from("student_answers")
        .select(`
          *,
          exams (id, title, template_type, created_at)
        `)
        .eq("student_id", studentId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[STUDENT_ANSWERS] Erro ao buscar:", error);
        return res.status(500).json({
          error: "Erro ao buscar resultados",
          details: error.message
        });
      }

      // Se não encontrou por student_id, tentar por student_number
      if (!data || data.length === 0) {
        console.log(`[STUDENT_ANSWERS] Sem resultados por student_id, buscando por student_number...`);

        // Buscar profile para pegar student_number
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("student_number")
          .eq("id", studentId)
          .single();

        if (profile?.student_number) {
          const { data: resultsByNumber } = await supabaseAdmin
            .from("student_answers")
            .select(`
              *,
              exams (id, title, template_type, created_at)
            `)
            .eq("student_number", profile.student_number)
            .order("created_at", { ascending: false });

          if (resultsByNumber && resultsByNumber.length > 0) {
            data = resultsByNumber;
            console.log(`[STUDENT_ANSWERS] Encontrados ${data.length} resultados por student_number: ${profile.student_number}`);
          }
        }
      }

      res.json({
        success: true,
        results: data || [],
        total: data?.length || 0
      });

    } catch (error: any) {
      console.error("[STUDENT_ANSWERS] Erro:", error);
      res.status(500).json({
        error: "Erro ao buscar resultados do aluno",
        details: error.message
      });
    }
  });

  // GET /api/student-dashboard-details/:studentId/:examId - Dados detalhados para dashboard do aluno
  app.get("/api/student-dashboard-details/:studentId/:examId", async (req: Request, res: Response) => {
    try {
      const { studentId, examId } = req.params;

      // 1. Buscar dados do aluno para este exam (primeiro por student_id)
      let studentResult = null;

      const { data: resultById, error: errorById } = await supabaseAdmin
        .from("student_answers")
        .select("*")
        .eq("student_id", studentId)
        .eq("exam_id", examId)
        .single();

      if (resultById) {
        studentResult = resultById;
      } else {
        // Fallback: buscar pelo student_number do profile
        console.log(`[STUDENT_DASHBOARD_DETAILS] Buscando por student_id falhou, tentando por student_number...`);

        // Buscar profile para pegar student_number
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("student_number")
          .eq("id", studentId)
          .single();

        if (profile?.student_number) {
          const { data: resultByNumber } = await supabaseAdmin
            .from("student_answers")
            .select("*")
            .eq("student_number", profile.student_number)
            .eq("exam_id", examId)
            .single();

          if (resultByNumber) {
            studentResult = resultByNumber;
            console.log(`[STUDENT_DASHBOARD_DETAILS] Encontrado por student_number: ${profile.student_number}`);
          }
        }
      }

      if (!studentResult) {
        return res.status(404).json({ error: "Resultado do aluno não encontrado" });
      }

      // 2. Buscar dados do exam (gabarito, question_contents)
      const { data: exam, error: examError } = await supabaseAdmin
        .from("exams")
        .select("id, title, template_type, total_questions, answer_key, question_contents")
        .eq("id", examId)
        .single();

      if (examError || !exam) {
        return res.status(404).json({ error: "Prova não encontrada" });
      }

      // 3. Buscar TODOS os resultados da turma para este exam (para calcular dificuldade e comparação)
      const { data: allResults, error: allError } = await supabaseAdmin
        .from("student_answers")
        .select("id, student_name, student_number, turma, answers, correct_answers, tri_score, tri_lc, tri_ch, tri_cn, tri_mt")
        .eq("exam_id", examId);

      if (allError) {
        console.error("[STUDENT_DASHBOARD_DETAILS] Erro ao buscar turma:", allError);
      }

      const turmaResults = allResults || [];
      const totalStudents = turmaResults.length;
      let answerKey = exam.answer_key || [];
      let questionContents = exam.question_contents || [];

      console.log(`[STUDENT_DASHBOARD_DETAILS] examId=${examId}`);
      console.log(`[STUDENT_DASHBOARD_DETAILS] totalStudents=${totalStudents}`);
      console.log(`[STUDENT_DASHBOARD_DETAILS] answerKey.length=${answerKey.length}`);

      // Se answerKey estiver vazio, tentar buscar do projeto mais recente
      if (answerKey.length === 0) {
        console.log(`[STUDENT_DASHBOARD_DETAILS] answerKey vazio, buscando de projetos...`);

        // Buscar projeto mais recente com mesmo número de alunos
        const { data: projetos } = await supabaseAdmin
          .from('projetos')
          .select('answer_key, question_contents, students')
          .order('created_at', { ascending: false })
          .limit(10);

        if (projetos && projetos.length > 0) {
          // Encontrar projeto com número similar de alunos
          const projetoMatch = projetos.find(p => {
            const pStudents = (p.students as any[]) || [];
            return Math.abs(pStudents.length - totalStudents) <= 2;
          });

          if (projetoMatch) {
            answerKey = projetoMatch.answer_key || [];
            questionContents = projetoMatch.question_contents || [];
            console.log(`[STUDENT_DASHBOARD_DETAILS] Encontrado answerKey do projeto: ${answerKey.length} questões`);
            console.log(`[STUDENT_DASHBOARD_DETAILS] questionContents.length=${questionContents.length}`);
            if (questionContents.length > 0) {
              console.log(`[STUDENT_DASHBOARD_DETAILS] questionContents[0]=`, JSON.stringify(questionContents[0]));
            }
          }
        }
      }

      // Debug: verificar questionContents
      console.log(`[STUDENT_DASHBOARD_DETAILS] Final questionContents.length=${questionContents.length}`);

      // 4. Calcular dificuldade de cada questão (% de acertos da turma)
      const questionDifficulty: Array<{
        questionNumber: number;
        area: string;
        content: string;
        correctRate: number;
        difficulty: 'easy' | 'medium' | 'hard';
        totalCorrect: number;
        totalStudents: number;
      }> = [];

      for (let i = 0; i < answerKey.length; i++) {
        const correctAnswer = answerKey[i];
        if (!correctAnswer || correctAnswer.trim() === '') continue;

        let correctCount = 0;
        turmaResults.forEach(student => {
          const studentAnswer = student.answers?.[i];
          if (studentAnswer && studentAnswer.toUpperCase() === correctAnswer.toUpperCase()) {
            correctCount++;
          }
        });

        const correctRate = totalStudents > 0 ? (correctCount / totalStudents) * 100 : 0;

        // Determinar área baseado no índice (ENEM padrão: 0-44 LC, 45-89 CH, 90-134 CN, 135-179 MT)
        let area = 'LC';
        if (i >= 45 && i < 90) area = 'CH';
        else if (i >= 90 && i < 135) area = 'CN';
        else if (i >= 135) area = 'MT';

        // Buscar conteúdo da questão se disponível
        const qContent = questionContents.find((q: any) => q.questionNumber === i + 1);

        questionDifficulty.push({
          questionNumber: i + 1,
          area,
          content: qContent?.content || '',
          correctRate: Math.round(correctRate * 10) / 10,
          difficulty: correctRate >= 70 ? 'easy' : correctRate >= 49 ? 'medium' : 'hard',
          totalCorrect: correctCount,
          totalStudents
        });
      }

      // 5. Calcular questões erradas pelo aluno
      const studentWrongQuestions: Array<{
        questionNumber: number;
        area: string;
        content: string;
        difficulty: 'easy' | 'medium' | 'hard';
        correctRate: number;
        studentAnswer: string;
        correctAnswer: string;
      }> = [];

      for (let i = 0; i < answerKey.length; i++) {
        const correctAnswer = answerKey[i];
        const studentAnswer = studentResult.answers?.[i];

        if (!correctAnswer || correctAnswer.trim() === '') continue;

        // Verificar se errou (respondeu mas não acertou)
        if (studentAnswer && studentAnswer.toUpperCase() !== correctAnswer.toUpperCase()) {
          const qDiff = questionDifficulty.find(q => q.questionNumber === i + 1);
          studentWrongQuestions.push({
            questionNumber: i + 1,
            area: qDiff?.area || 'LC',
            content: qDiff?.content || '',
            difficulty: qDiff?.difficulty || 'medium',
            correctRate: qDiff?.correctRate || 0,
            studentAnswer: studentAnswer.toUpperCase(),
            correctAnswer: correctAnswer.toUpperCase()
          });
        }
      }

      // 6. Calcular resumo por dificuldade
      const difficultyStats = {
        easy: { total: 0, correct: 0, wrong: 0 },
        medium: { total: 0, correct: 0, wrong: 0 },
        hard: { total: 0, correct: 0, wrong: 0 }
      };

      questionDifficulty.forEach(q => {
        const studentAnswer = studentResult.answers?.[q.questionNumber - 1];
        const correctAnswer = answerKey[q.questionNumber - 1];

        difficultyStats[q.difficulty].total++;

        if (studentAnswer && correctAnswer) {
          if (studentAnswer.toUpperCase() === correctAnswer.toUpperCase()) {
            difficultyStats[q.difficulty].correct++;
          } else {
            difficultyStats[q.difficulty].wrong++;
          }
        }
      });

      // 7. Calcular conteúdos com mais erros
      const contentErrors: Record<string, { content: string; area: string; errors: number; total: number }> = {};

      studentWrongQuestions.forEach(q => {
        const key = q.content || `Questão ${q.questionNumber}`;
        if (!contentErrors[key]) {
          contentErrors[key] = { content: key, area: q.area, errors: 0, total: 0 };
        }
        contentErrors[key].errors++;
      });

      // Adicionar questões corretas para calcular total
      questionDifficulty.forEach(q => {
        const key = q.content || `Questão ${q.questionNumber}`;
        if (!contentErrors[key]) {
          contentErrors[key] = { content: key, area: q.area, errors: 0, total: 0 };
        }
        contentErrors[key].total++;
      });

      const topErrorContents = Object.values(contentErrors)
        .filter(c => c.errors > 0)
        .sort((a, b) => (b.errors / b.total) - (a.errors / a.total))
        .slice(0, 10);

      // 8. Calcular estatísticas da turma por área
      const turmaStats = {
        LC: { min: 1000, max: 0, avg: 0, count: 0, sum: 0 },
        CH: { min: 1000, max: 0, avg: 0, count: 0, sum: 0 },
        CN: { min: 1000, max: 0, avg: 0, count: 0, sum: 0 },
        MT: { min: 1000, max: 0, avg: 0, count: 0, sum: 0 }
      };

      turmaResults.forEach(r => {
        ['LC', 'CH', 'CN', 'MT'].forEach(area => {
          const tri = area === 'LC' ? r.tri_lc : area === 'CH' ? r.tri_ch : area === 'CN' ? r.tri_cn : r.tri_mt;
          if (tri && tri > 0) {
            const stats = turmaStats[area as keyof typeof turmaStats];
            stats.min = Math.min(stats.min, tri);
            stats.max = Math.max(stats.max, tri);
            stats.sum += tri;
            stats.count++;
          }
        });
      });

      // Calcular médias
      Object.keys(turmaStats).forEach(area => {
        const stats = turmaStats[area as keyof typeof turmaStats];
        stats.avg = stats.count > 0 ? Math.round((stats.sum / stats.count) * 10) / 10 : 0;
        if (stats.min === 1000) stats.min = 0;
      });

      // 9. Dados para scatter chart (turma inteira sem nomes - privacidade)
      const turmaScatterData = turmaResults.map(r => ({
        acertos: r.correct_answers || 0,
        tri: r.tri_score || 0,
        isCurrentStudent: r.student_number === studentResult.student_number
      }));

      res.json({
        success: true,
        studentResult,
        exam: {
          id: exam.id,
          title: exam.title,
          templateType: exam.template_type,
          totalQuestions: exam.total_questions
        },
        answerKey,
        questionContents,
        questionDifficulty,
        studentWrongQuestions,
        difficultyStats,
        topErrorContents,
        turmaStats,
        turmaSize: totalStudents,
        turmaScatterData
      });

    } catch (error: any) {
      console.error("[STUDENT_DASHBOARD_DETAILS] Erro:", error);
      res.status(500).json({
        error: "Erro ao buscar detalhes do dashboard",
        details: error.message
      });
    }
  });

  // POST /api/exams - Criar uma prova
  app.post("/api/exams", async (req: Request, res: Response) => {
    try {
      const { school_id, title, template_type, total_questions, answer_key } = req.body;

      if (!school_id || !title) {
        return res.status(400).json({
          error: "Dados obrigatórios faltando",
          required: ["school_id", "title"]
        });
      }

      const { data, error } = await supabaseAdmin
        .from("exams")
        .insert({
          school_id,
          title,
          template_type: template_type || "ENEM",
          total_questions: total_questions || 45,
          answer_key: answer_key || null
        })
        .select()
        .single();

      if (error) {
        console.error("[EXAMS] Erro ao criar:", error);
        return res.status(500).json({
          error: "Erro ao criar prova",
          details: error.message
        });
      }

      res.json({
        success: true,
        exam: data
      });

    } catch (error: any) {
      console.error("[EXAMS] Erro:", error);
      res.status(500).json({
        error: "Erro ao criar prova",
        details: error.message
      });
    }
  });

  // PATCH /api/exams/:examId - Atualizar gabarito de uma prova existente
  app.patch("/api/exams/:examId", async (req: Request, res: Response) => {
    try {
      const { examId } = req.params;
      const { answer_key, question_contents } = req.body;

      if (!answer_key && !question_contents) {
        return res.status(400).json({
          error: "Nenhum dado para atualizar",
          hint: "Envie answer_key e/ou question_contents"
        });
      }

      const updateData: Record<string, any> = {};
      if (answer_key) updateData.answer_key = answer_key;
      if (question_contents) updateData.question_contents = question_contents;

      const { data, error } = await supabaseAdmin
        .from("exams")
        .update(updateData)
        .eq("id", examId)
        .select()
        .single();

      if (error) {
        console.error("[EXAMS] Erro ao atualizar:", error);
        return res.status(500).json({
          error: "Erro ao atualizar prova",
          details: error.message
        });
      }

      console.log(`[EXAMS] Gabarito atualizado para exam ${examId}: ${answer_key?.length || 0} questões`);

      res.json({
        success: true,
        exam: data
      });

    } catch (error: any) {
      console.error("[EXAMS] Erro:", error);
      res.status(500).json({
        error: "Erro ao atualizar prova",
        details: error.message
      });
    }
  });

  // GET /api/exams - Listar provas
  app.get("/api/exams", async (req: Request, res: Response) => {
    try {
      const { school_id } = req.query;

      let query = supabaseAdmin.from("exams").select("*");

      if (school_id) {
        query = query.eq("school_id", school_id as string);
      }

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) {
        console.error("[EXAMS] Erro ao listar:", error);
        return res.status(500).json({
          error: "Erro ao listar provas",
          details: error.message
        });
      }

      res.json({
        success: true,
        exams: data || []
      });

    } catch (error: any) {
      console.error("[EXAMS] Erro:", error);
      res.status(500).json({
        error: "Erro ao listar provas",
        details: error.message
      });
    }
  });

  // GAB-110: GET /api/auth/email-by-matricula/:matricula - Buscar email pelo número de matrícula
  app.get("/api/auth/email-by-matricula/:matricula", async (req: Request, res: Response) => {
    try {
      const { matricula } = req.params;

      if (!matricula || matricula.trim() === '') {
        return res.status(400).json({
          error: "Matrícula não fornecida"
        });
      }

      console.log(`[AUTH] Buscando email para matrícula: ${matricula}`);

      const { data: profile, error } = await supabaseAdmin
        .from("profiles")
        .select("id, email, name, student_number")
        .eq("student_number", matricula.trim())
        .single();

      if (error || !profile) {
        console.log(`[AUTH] Matrícula não encontrada: ${matricula}`);
        return res.status(404).json({
          error: "Matrícula não encontrada",
          message: "Não existe nenhum aluno cadastrado com essa matrícula."
        });
      }

      console.log(`[AUTH] Matrícula ${matricula} encontrada: ${profile.email}`);

      res.json({
        success: true,
        email: profile.email,
        name: profile.name
      });

    } catch (error: any) {
      console.error("[AUTH] Erro ao buscar email por matrícula:", error);
      res.status(500).json({
        error: "Erro ao buscar matrícula",
        details: error.message
      });
    }
  });

  // POST /api/auth/promote-to-admin - Promover usuário atual para super_admin
  // ⚠️ ENDPOINT TEMPORÁRIO - remover em produção
  app.post("/api/auth/promote-to-admin", requireAuth, async (req: Request, res: Response) => {
    try {
      const authReq = req as any;
      const userId = authReq.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Usuário não autenticado" });
      }

      // Buscar profile atual
      const { data: profile, error: fetchError } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (fetchError || !profile) {
        return res.status(404).json({ error: "Perfil não encontrado" });
      }

      console.log(`[PROMOTE] Role atual: ${profile.role} -> super_admin`);

      // Atualizar para super_admin
      const { error: updateError } = await supabaseAdmin
        .from("profiles")
        .update({ role: 'super_admin' })
        .eq("id", userId);

      if (updateError) {
        throw updateError;
      }

      res.json({
        success: true,
        message: "Usuário promovido a super_admin",
        user: {
          id: userId,
          email: profile.email,
          name: profile.name,
          oldRole: profile.role,
          newRole: 'super_admin'
        }
      });
    } catch (error: any) {
      console.error("[PROMOTE] Erro:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/auth/my-role - Verificar role do usuário atual
  app.get("/api/auth/my-role", requireAuth, async (req: Request, res: Response) => {
    try {
      const authReq = req as any;
      const userId = authReq.user?.id;

      const { data: profile, error } = await supabaseAdmin
        .from("profiles")
        .select("id, email, name, role, school_id")
        .eq("id", userId)
        .single();

      if (error || !profile) {
        return res.status(404).json({ error: "Perfil não encontrado" });
      }

      res.json(profile);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/auth/login-matricula - Login por MATRÍCULA + SENHA (não por email)
  // Fluxo: Aluno digita matrícula + senha → backend busca email → autentica no Supabase
  // Se o aluno tem profile mas não tem Auth user, retorna needsRegistration: true
  app.post("/api/auth/login-matricula", async (req: Request, res: Response) => {
    try {
      const { matricula, senha } = req.body as { matricula: string; senha: string };

      if (!matricula || !senha) {
        return res.status(400).json({
          error: "Matrícula e senha são obrigatórios"
        });
      }

      console.log(`[LOGIN] Tentativa de login com matrícula: ${matricula}`);

      // 1. Buscar profile pela matrícula para obter o email
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("id, email, name, student_number, role")
        .eq("student_number", matricula.trim())
        .single();

      if (profileError || !profile) {
        console.log(`[LOGIN] Matrícula não encontrada: ${matricula}`);
        return res.status(401).json({
          error: "Matrícula não encontrada"
        });
      }

      // 2. Verificar se existe Auth user para este profile
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(profile.id);

      if (!authUser?.user) {
        // Profile existe mas não tem Auth user - precisa registrar senha
        console.log(`[LOGIN] Profile existe mas sem Auth user: ${matricula}`);
        return res.status(200).json({
          success: false,
          needsRegistration: true,
          message: "Primeiro acesso. Por favor, defina sua senha.",
          profile: {
            id: profile.id,
            name: profile.name,
            matricula: profile.student_number,
            email: profile.email
          }
        });
      }

      // 3. Autenticar no Supabase usando o email encontrado
      const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
        email: profile.email,
        password: senha
      });

      if (authError || !authData.session) {
        console.log(`[LOGIN] Senha incorreta para matrícula: ${matricula}`);
        return res.status(401).json({
          error: "Senha incorreta"
        });
      }

      // 4. Verificar se precisa trocar senha (must_change_password)
      const mustChangePassword = authData.user?.user_metadata?.must_change_password === true;

      console.log(`[LOGIN] ✅ Login bem-sucedido: ${matricula} (${profile.name})`);

      res.json({
        success: true,
        session: authData.session,
        user: {
          id: authData.user.id,
          email: profile.email,
          name: profile.name,
          matricula: profile.student_number,
          role: profile.role
        },
        mustChangePassword
      });

    } catch (error: any) {
      console.error("[LOGIN] Erro:", error);
      res.status(500).json({
        error: "Erro ao fazer login",
        details: error.message
      });
    }
  });

  // POST /api/auth/register-student - Registrar senha para aluno existente (primeiro acesso)
  // Aluno já tem profile (importado via CSV) mas não tem Auth user
  app.post("/api/auth/register-student", async (req: Request, res: Response) => {
    const DEFAULT_PASSWORD = 'SENHA123';

    try {
      const { matricula, senha } = req.body as { matricula: string; senha: string };

      if (!matricula || !senha) {
        return res.status(400).json({
          error: "Matrícula e senha são obrigatórios"
        });
      }

      if (senha.length < 6) {
        return res.status(400).json({
          error: "Senha deve ter pelo menos 6 caracteres"
        });
      }

      console.log(`[REGISTER] Registrando senha para matrícula: ${matricula}`);

      // 1. Buscar profile pela matrícula
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("id, email, name, student_number, role")
        .eq("student_number", matricula.trim())
        .single();

      if (profileError || !profile) {
        console.log(`[REGISTER] Matrícula não encontrada: ${matricula}`);
        return res.status(404).json({
          error: "Matrícula não encontrada"
        });
      }

      // 2. Verificar se já existe Auth user
      const { data: existingAuth } = await supabaseAdmin.auth.admin.getUserById(profile.id);

      if (existingAuth?.user) {
        console.log(`[REGISTER] Auth user já existe para: ${matricula}`);
        return res.status(400).json({
          error: "Você já tem uma conta. Use o login normal.",
          hint: "Se esqueceu a senha, solicite reset ao administrador."
        });
      }

      // 3. Criar Auth user com a senha fornecida
      const { data: newAuth, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: profile.email,
        password: senha,
        email_confirm: true,
        user_metadata: {
          name: profile.name,
          student_number: matricula,
          must_change_password: false
        }
      });

      if (authError) {
        console.error(`[REGISTER] Erro ao criar Auth user: ${authError.message}`);
        return res.status(500).json({
          error: "Erro ao criar conta",
          details: authError.message
        });
      }

      // 4. Atualizar o profile para usar o ID do Auth user
      // (importante: o profile.id pode ser diferente do auth user id)
      if (newAuth.user && newAuth.user.id !== profile.id) {
        // Deletar profile antigo e criar com novo ID
        await supabaseAdmin.from("profiles").delete().eq("id", profile.id);
        await supabaseAdmin.from("profiles").insert({
          id: newAuth.user.id,
          email: profile.email,
          name: profile.name,
          role: profile.role,
          student_number: profile.student_number,
          turma: (profile as any).turma,
          school_id: (profile as any).school_id
        });
      }

      // 5. Fazer login automático
      const { data: authData, error: loginError } = await supabaseAdmin.auth.signInWithPassword({
        email: profile.email,
        password: senha
      });

      if (loginError || !authData.session) {
        // Conta criada mas login falhou - ainda assim é sucesso
        console.log(`[REGISTER] ✅ Conta criada, login manual necessário: ${matricula}`);
        return res.json({
          success: true,
          message: "Conta criada com sucesso! Faça login.",
          needsLogin: true
        });
      }

      console.log(`[REGISTER] ✅ Conta criada e logado: ${matricula} (${profile.name})`);

      res.json({
        success: true,
        message: "Conta criada com sucesso!",
        session: authData.session,
        user: {
          id: authData.user.id,
          email: profile.email,
          name: profile.name,
          matricula: profile.student_number,
          role: profile.role
        }
      });

    } catch (error: any) {
      console.error("[REGISTER] Erro:", error);
      res.status(500).json({
        error: "Erro ao registrar",
        details: error.message
      });
    }
  });

  // GET /api/profile/:userId - Buscar profile de um usuário (bypass RLS)
  app.get("/api/profile/:userId", async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;

      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) {
        console.error("[PROFILE] Erro ao buscar:", error);
        return res.status(404).json({
          error: "Profile não encontrado",
          details: error.message
        });
      }

      res.json(data);

    } catch (error: any) {
      console.error("[PROFILE] Erro:", error);
      res.status(500).json({
        error: "Erro ao buscar profile",
        details: error.message
      });
    }
  });

  // PUT /api/profile/update - Atualizar perfil do usuário
  app.put("/api/profile/update", async (req: Request, res: Response) => {
    try {
      const { userId, name } = req.body;

      if (!userId || !name) {
        return res.status(400).json({ error: "userId e name são obrigatórios" });
      }

      const { data, error } = await supabaseAdmin
        .from("profiles")
        .update({ name })
        .eq("id", userId)
        .select()
        .single();

      if (error) {
        console.error("[PROFILE] Erro ao atualizar:", error);
        return res.status(500).json({ error: "Erro ao atualizar perfil", details: error.message });
      }

      res.json({ success: true, profile: data });

    } catch (error: any) {
      console.error("[PROFILE] Erro:", error);
      res.status(500).json({ error: "Erro ao atualizar perfil", details: error.message });
    }
  });

  // POST /api/profile/change-password - Alterar senha do usuário
  app.post("/api/profile/change-password", async (req: Request, res: Response) => {
    try {
      const { userId, currentPassword, newPassword, isForced } = req.body;

      if (!userId || !newPassword) {
        return res.status(400).json({ error: "userId e newPassword são obrigatórios" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres" });
      }

      // Buscar o perfil do usuário para pegar o email
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("id", userId)
        .single();

      if (profileError || !profile) {
        return res.status(404).json({ error: "Usuário não encontrado" });
      }

      // Se não é forçado, verificar senha atual
      if (!isForced && currentPassword) {
        const { error: signInError } = await supabaseAdmin.auth.signInWithPassword({
          email: profile.email,
          password: currentPassword
        });

        if (signInError) {
          return res.status(400).json({ error: "Senha atual incorreta" });
        }
      }

      // Atualizar a senha usando admin API
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: newPassword
      });

      if (updateError) {
        console.error("[PROFILE] Erro ao atualizar senha:", updateError);
        return res.status(500).json({ error: "Erro ao alterar senha", details: updateError.message });
      }

      // Marcar must_change_password como false
      await supabaseAdmin
        .from("profiles")
        .update({ must_change_password: false })
        .eq("id", userId);

      res.json({ success: true, message: "Senha alterada com sucesso" });

    } catch (error: any) {
      console.error("[PROFILE] Erro:", error);
      res.status(500).json({ error: "Erro ao alterar senha", details: error.message });
    }
  });

  // ===========================================================================
  // ESCOLA ENDPOINTS - Para school_admin (coordenadores)
  // ===========================================================================

  // GET /api/escola/results - Buscar resultados dos alunos da escola
  // PROTEGIDO: Apenas school_admin e super_admin podem ver resultados
  app.get("/api/escola/results", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const allowedSeries = (req as any).profile?.allowed_series || null;
      console.log(`[ESCOLA RESULTS] User: ${(req as any).profile?.name}, Allowed series: ${allowedSeries?.join(', ') || 'ALL'}`);

      // Buscar student_answers com info do exame
      const { data: answers, error: answersError } = await supabaseAdmin
        .from("student_answers")
        .select(`
          id,
          student_name,
          student_number,
          turma,
          score,
          correct_answers,
          wrong_answers,
          blank_answers,
          tri_lc,
          tri_ch,
          tri_cn,
          tri_mt,
          created_at,
          exams(title)
        `)
        .order("created_at", { ascending: false })
        .limit(500);

      if (answersError) {
        console.error("[ESCOLA] Erro ao buscar resultados:", answersError);
        return res.status(500).json({ error: answersError.message });
      }

      // Filter by allowed_series if coordinator has restrictions
      const filteredAnswers = (answers || []).filter((a: any) =>
        isTurmaAllowed(a.turma, allowedSeries)
      );

      // Formatar resultados
      const results = filteredAnswers.map((a: any) => ({
        id: a.id,
        student_name: a.student_name,
        student_number: a.student_number,
        turma: a.turma,
        score: a.score,
        correct_answers: a.correct_answers,
        wrong_answers: a.wrong_answers,
        blank_answers: a.blank_answers,
        tri_lc: a.tri_lc,
        tri_ch: a.tri_ch,
        tri_cn: a.tri_cn,
        tri_mt: a.tri_mt,
        exam_title: a.exams?.title || "Prova sem título",
        created_at: a.created_at,
      }));

      // Calcular estatísticas
      const turmasSet = new Set<string>();
      let totalScore = 0;
      let scoreCount = 0;

      results.forEach((r: any) => {
        if (r.turma) turmasSet.add(r.turma);
        if (r.correct_answers != null) {
          totalScore += r.correct_answers;
          scoreCount++;
        }
      });

      // Buscar total de alunos únicos
      const uniqueStudents = new Set(results.map((r: any) => r.student_number || r.student_name));

      // Buscar total de provas
      const { count: examCount } = await supabaseAdmin
        .from("exams")
        .select("*", { count: "exact", head: true });

      const stats = {
        totalStudents: uniqueStudents.size,
        totalExams: examCount || 0,
        averageScore: scoreCount > 0 ? totalScore / scoreCount : 0,
        turmas: Array.from(turmasSet).sort(),
      };

      res.json({ results, stats });

    } catch (error: any) {
      console.error("[ESCOLA] Erro:", error);
      res.status(500).json({
        error: "Erro ao buscar dados da escola",
        details: error.message
      });
    }
  });

  // GET /api/escola/dashboard - Dashboard completo com rankings
  // PROTEGIDO: Apenas school_admin e super_admin podem ver dashboard
  app.get("/api/escola/dashboard", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const allowedSeries = (req as any).profile?.allowed_series || null;
      console.log(`[ESCOLA DASHBOARD] User: ${(req as any).profile?.name}, Allowed series: ${allowedSeries?.join(', ') || 'ALL'}`);

      // Buscar todos os resultados
      const { data: answers, error: answersError } = await supabaseAdmin
        .from("student_answers")
        .select(`
          id,
          student_name,
          student_number,
          turma,
          correct_answers,
          tri_lc,
          tri_ch,
          tri_cn,
          tri_mt,
          created_at,
          exams(title)
        `)
        .order("created_at", { ascending: false });

      if (answersError) throw answersError;

      // Filter by allowed_series if coordinator has restrictions
      const filteredAnswers = (answers || []).filter((a: any) =>
        isTurmaAllowed(a.turma, allowedSeries)
      );

      const results = filteredAnswers;

      // Extrair séries das turmas (ex: "1ª Série A" -> "1ª Série")
      const extractSerie = (turma: string | null): string => {
        if (!turma) return "Sem série";
        const match = turma.match(/^(\d+ª?\s*[Ss]érie|\d+º?\s*[Aa]no)/i);
        return match ? match[1] : turma;
      };

      // Estatísticas gerais
      const turmasSet = new Set<string>();
      const seriesSet = new Set<string>();
      const uniqueStudents = new Set<string>();
      let totalCorrect = 0;
      let totalCount = 0;
      let totalLC = 0, totalCH = 0, totalCN = 0, totalMT = 0;
      let triCount = 0;

      results.forEach((r: any) => {
        if (r.turma) {
          turmasSet.add(r.turma);
          seriesSet.add(extractSerie(r.turma));
        }
        uniqueStudents.add(r.student_number || r.student_name);
        if (r.correct_answers != null) {
          totalCorrect += r.correct_answers;
          totalCount++;
        }
        if (r.tri_lc != null) {
          totalLC += r.tri_lc;
          totalCH += r.tri_ch || 0;
          totalCN += r.tri_cn || 0;
          totalMT += r.tri_mt || 0;
          triCount++;
        }
      });

      // Ranking por turma
      const turmaStats: Record<string, {
        count: number;
        totalCorrect: number;
        students: Set<string>;
        tri_lc: number;
        tri_ch: number;
        tri_cn: number;
        tri_mt: number;
        triCount: number;
      }> = {};

      // Helper to normalize turma (null, "null", empty -> "Sem turma")
      const normalizeTurma = (turma: string | null): string => {
        if (!turma || turma === "null" || turma.trim() === "") return "Sem turma";
        return turma;
      };

      results.forEach((r: any) => {
        const turma = normalizeTurma(r.turma);
        if (!turmaStats[turma]) {
          turmaStats[turma] = {
            count: 0,
            totalCorrect: 0,
            students: new Set(),
            tri_lc: 0,
            tri_ch: 0,
            tri_cn: 0,
            tri_mt: 0,
            triCount: 0
          };
        }
        turmaStats[turma].count++;
        turmaStats[turma].totalCorrect += r.correct_answers || 0;
        turmaStats[turma].students.add(r.student_number || r.student_name);
        if (r.tri_lc != null) {
          turmaStats[turma].tri_lc += r.tri_lc;
          turmaStats[turma].tri_ch += r.tri_ch || 0;
          turmaStats[turma].tri_cn += r.tri_cn || 0;
          turmaStats[turma].tri_mt += r.tri_mt || 0;
          turmaStats[turma].triCount++;
        }
      });

      const turmaRanking = Object.entries(turmaStats)
        .map(([turma, data]) => ({
          turma,
          alunos: data.students.size,
          media: data.count > 0 ? data.totalCorrect / data.count : 0,
          tri_lc: data.triCount > 0 ? data.tri_lc / data.triCount : null,
          tri_ch: data.triCount > 0 ? data.tri_ch / data.triCount : null,
          tri_cn: data.triCount > 0 ? data.tri_cn / data.triCount : null,
          tri_mt: data.triCount > 0 ? data.tri_mt / data.triCount : null,
        }))
        .sort((a, b) => b.media - a.media);

      // Top 5 alunos (pelo último resultado)
      const studentBest: Record<string, any> = {};
      results.forEach((r: any) => {
        const key = r.student_number || r.student_name;
        if (!studentBest[key] || (r.correct_answers || 0) > (studentBest[key].correct_answers || 0)) {
          studentBest[key] = r;
        }
      });

      const topAlunos = Object.values(studentBest)
        .sort((a: any, b: any) => (b.correct_answers || 0) - (a.correct_answers || 0))
        .slice(0, 5)
        .map((r: any) => ({
          nome: r.student_name,
          matricula: r.student_number,
          turma: normalizeTurma(r.turma),
          acertos: r.correct_answers,
        }));

      // Alunos que precisam de atenção (abaixo de 50% = menos de 45 acertos em 90 questões)
      const threshold = 45; // 50% de 90 questões
      const atencao = Object.values(studentBest)
        .filter((r: any) => (r.correct_answers || 0) < threshold)
        .sort((a: any, b: any) => (a.correct_answers || 0) - (b.correct_answers || 0))
        .slice(0, 5)
        .map((r: any) => ({
          nome: r.student_name,
          matricula: r.student_number,
          turma: normalizeTurma(r.turma),
          acertos: r.correct_answers,
        }));

      // Contar provas únicas
      const { count: examCount } = await supabaseAdmin
        .from("exams")
        .select("*", { count: "exact", head: true });

      res.json({
        stats: {
          totalAlunos: uniqueStudents.size,
          totalProvas: examCount || 0,
          mediaAcertos: totalCount > 0 ? totalCorrect / totalCount : 0,
          totalTurmas: turmasSet.size,
          totalSeries: seriesSet.size,
        },
        turmaRanking,
        desempenhoPorArea: {
          lc: triCount > 0 ? totalLC / triCount : null,
          ch: triCount > 0 ? totalCH / triCount : null,
          cn: triCount > 0 ? totalCN / triCount : null,
          mt: triCount > 0 ? totalMT / triCount : null,
        },
        topAlunos,
        atencao,
        series: Array.from(seriesSet).sort(),
        turmas: Array.from(turmasSet).sort(),
      });

    } catch (error: any) {
      console.error("[ESCOLA DASHBOARD] Erro:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/escola/turmas/:turma/alunos - Alunos de uma turma com métricas comparativas
  // PROTEGIDO: Apenas school_admin e super_admin
  app.get("/api/escola/turmas/:turma/alunos", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const { turma } = req.params;
      const decodedTurma = decodeURIComponent(turma);
      const allowedSeries = (req as any).profile?.allowed_series || null;

      // Verify coordinator has access to this turma
      if (!isTurmaAllowed(decodedTurma, allowedSeries)) {
        return res.status(403).json({
          error: "Acesso negado a esta turma",
          code: "SERIES_ACCESS_DENIED"
        });
      }

      // Buscar resultados da turma
      const { data: answers, error } = await supabaseAdmin
        .from("student_answers")
        .select(`
          id,
          student_name,
          student_number,
          turma,
          correct_answers,
          tri_lc,
          tri_ch,
          tri_cn,
          tri_mt,
          created_at,
          exams(title)
        `)
        .eq("turma", decodedTurma)
        .order("correct_answers", { ascending: false });

      if (error) throw error;

      const results = answers || [];

      // Calcular médias da turma
      let totalCorrect = 0, totalLC = 0, totalCH = 0, totalCN = 0, totalMT = 0;
      let count = 0, triCount = 0;

      results.forEach((r: any) => {
        if (r.correct_answers != null) {
          totalCorrect += r.correct_answers;
          count++;
        }
        if (r.tri_lc != null) {
          totalLC += r.tri_lc;
          totalCH += r.tri_ch || 0;
          totalCN += r.tri_cn || 0;
          totalMT += r.tri_mt || 0;
          triCount++;
        }
      });

      const mediaTurma = {
        acertos: count > 0 ? totalCorrect / count : 0,
        lc: triCount > 0 ? totalLC / triCount : null,
        ch: triCount > 0 ? totalCH / triCount : null,
        cn: triCount > 0 ? totalCN / triCount : null,
        mt: triCount > 0 ? totalMT / triCount : null,
      };

      // Agrupar por aluno (pegar melhor resultado)
      const studentBest: Record<string, any> = {};
      results.forEach((r: any) => {
        const key = r.student_number || r.student_name;
        if (!studentBest[key] || (r.correct_answers || 0) > (studentBest[key].correct_answers || 0)) {
          studentBest[key] = r;
        }
      });

      // Ordenar e adicionar posição
      const alunos = Object.values(studentBest)
        .sort((a: any, b: any) => (b.correct_answers || 0) - (a.correct_answers || 0))
        .map((r: any, index: number) => ({
          posicao: index + 1,
          nome: r.student_name,
          matricula: r.student_number,
          acertos: r.correct_answers,
          tri_lc: r.tri_lc,
          tri_ch: r.tri_ch,
          tri_cn: r.tri_cn,
          tri_mt: r.tri_mt,
          comparacao: {
            acertos: r.correct_answers != null ? (r.correct_answers > mediaTurma.acertos ? "acima" : r.correct_answers < mediaTurma.acertos ? "abaixo" : "media") : null,
          },
          prova: r.exams?.title,
          data: r.created_at,
        }));

      res.json({
        turma: decodedTurma,
        totalAlunos: alunos.length,
        mediaTurma,
        alunos,
      });

    } catch (error: any) {
      console.error("[ESCOLA TURMA ALUNOS] Erro:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/escola/turmas/:turma/export-excel - Exportar notas da turma para Excel
  // PROTEGIDO: Apenas school_admin e super_admin
  app.get("/api/escola/turmas/:turma/export-excel", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const { turma } = req.params;
      const decodedTurma = decodeURIComponent(turma);
      const allowedSeries = (req as any).profile?.allowed_series || null;

      // Verify coordinator has access to this turma
      if (!isTurmaAllowed(decodedTurma, allowedSeries)) {
        return res.status(403).json({
          error: "Acesso negado a esta turma",
          code: "SERIES_ACCESS_DENIED"
        });
      }

      console.log(`[ESCOLA EXPORT EXCEL] Exportando turma: ${decodedTurma}`);

      // Buscar resultados da turma com todos os dados
      const { data: answers, error } = await supabaseAdmin
        .from("student_answers")
        .select(`
          id,
          student_name,
          student_number,
          turma,
          correct_answers,
          wrong_answers,
          blank_answers,
          answers,
          tri_lc,
          tri_ch,
          tri_cn,
          tri_mt,
          confidence,
          created_at,
          exams(id, title, answer_key)
        `)
        .eq("turma", decodedTurma)
        .order("correct_answers", { ascending: false });

      if (error) throw error;

      const results = answers || [];

      if (results.length === 0) {
        return res.status(404).json({ error: "Nenhum resultado encontrado para esta turma" });
      }

      // Agrupar por aluno (pegar melhor resultado)
      const studentBest: Record<string, any> = {};
      results.forEach((r: any) => {
        const key = r.student_number || r.student_name;
        if (!studentBest[key] || (r.correct_answers || 0) > (studentBest[key].correct_answers || 0)) {
          studentBest[key] = r;
        }
      });

      // Converter para formato do ExcelExporter
      const students = Object.values(studentBest)
        .sort((a: any, b: any) => (b.correct_answers || 0) - (a.correct_answers || 0))
        .map((r: any) => ({
          id: r.id,
          studentNumber: r.student_number || "",
          studentName: r.student_name || "",
          turma: r.turma,
          answers: r.answers || [],
          correctAnswers: r.correct_answers || 0,
          wrongAnswers: r.wrong_answers || 0,
          blankAnswers: r.blank_answers || 0,
          score: r.correct_answers ? (r.correct_answers / 90) * 10 : 0, // TCT score
          confidence: r.confidence || 0,
          pageNumber: 1,
        }));

      // Obter gabarito da primeira prova (se disponível)
      const firstExam = results[0]?.exams;
      const answerKey = firstExam?.answer_key || [];

      // Preparar TRI scores
      const triScores = new Map<string, number>();
      const triScoresByArea = new Map<string, Record<string, number>>();

      Object.values(studentBest).forEach((r: any) => {
        // TRI geral (média das 4 áreas)
        const triValues = [r.tri_lc, r.tri_ch, r.tri_cn, r.tri_mt].filter(v => v != null);
        if (triValues.length > 0) {
          const triMedia = triValues.reduce((a, b) => a + b, 0) / triValues.length;
          triScores.set(r.id, triMedia);
        }

        // TRI por área
        triScoresByArea.set(r.id, {
          LC: r.tri_lc || 0,
          CH: r.tri_ch || 0,
          CN: r.tri_cn || 0,
          MT: r.tri_mt || 0,
        });
      });

      // Gerar Excel
      const excelBuffer = await ExcelExporter.generateExcel({
        students,
        answerKey,
        includeTRI: true,
        triScores,
        triScoresByArea,
      });

      // Sanitizar nome da turma para o arquivo
      const safeTurmaName = decodedTurma.replace(/[^a-zA-Z0-9áéíóúâêîôûàèìòùãõäëïöüçÁÉÍÓÚÂÊÎÔÛÀÈÌÒÙÃÕÄËÏÖÜÇ\s-]/g, "").replace(/\s+/g, "_");
      const fileName = `Notas_${safeTurmaName}_${new Date().toISOString().split("T")[0]}.xlsx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(excelBuffer);

      console.log(`[ESCOLA EXPORT EXCEL] Exportado com sucesso: ${students.length} alunos`);

    } catch (error: any) {
      console.error("[ESCOLA EXPORT EXCEL] Erro:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/escola/alunos/:matricula/historico - Histórico completo de um aluno
  // PROTEGIDO: Apenas school_admin e super_admin
  app.get("/api/escola/alunos/:matricula/historico", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const { matricula } = req.params;
      const decodedMatricula = decodeURIComponent(matricula);

      // Buscar todas as provas do aluno
      const { data: answers, error } = await supabaseAdmin
        .from("student_answers")
        .select(`
          id,
          student_name,
          student_number,
          turma,
          correct_answers,
          wrong_answers,
          blank_answers,
          tri_lc,
          tri_ch,
          tri_cn,
          tri_mt,
          created_at,
          exams(title)
        `)
        .eq("student_number", decodedMatricula)
        .order("created_at", { ascending: true });

      if (error) throw error;

      const results = answers || [];

      if (results.length === 0) {
        return res.status(404).json({ error: "Aluno não encontrado" });
      }

      const aluno = {
        nome: results[0].student_name,
        matricula: results[0].student_number,
        turma: results[0].turma,
      };

      // Buscar média da turma para comparação
      const { data: turmaAnswers } = await supabaseAdmin
        .from("student_answers")
        .select("correct_answers, tri_lc, tri_ch, tri_cn, tri_mt")
        .eq("turma", aluno.turma);

      let mediaTurma = { acertos: 0, lc: 0, ch: 0, cn: 0, mt: 0 };
      if (turmaAnswers && turmaAnswers.length > 0) {
        const count = turmaAnswers.length;
        mediaTurma = {
          acertos: turmaAnswers.reduce((sum, r) => sum + (r.correct_answers || 0), 0) / count,
          lc: turmaAnswers.reduce((sum, r) => sum + (r.tri_lc || 0), 0) / count,
          ch: turmaAnswers.reduce((sum, r) => sum + (r.tri_ch || 0), 0) / count,
          cn: turmaAnswers.reduce((sum, r) => sum + (r.tri_cn || 0), 0) / count,
          mt: turmaAnswers.reduce((sum, r) => sum + (r.tri_mt || 0), 0) / count,
        };
      }

      // Calcular posição na turma
      const turmaRanking = (turmaAnswers || [])
        .map(r => r.correct_answers || 0)
        .sort((a, b) => b - a);

      const ultimoAcerto = results[results.length - 1]?.correct_answers || 0;
      const posicao = turmaRanking.findIndex(a => a <= ultimoAcerto) + 1;
      const totalTurma = turmaRanking.length;

      // Histórico formatado
      const historico = results.map((r: any) => ({
        id: r.id,
        prova: r.exams?.title || "Prova",
        data: r.created_at,
        acertos: r.correct_answers,
        erros: r.wrong_answers,
        brancos: r.blank_answers,
        tri_lc: r.tri_lc,
        tri_ch: r.tri_ch,
        tri_cn: r.tri_cn,
        tri_mt: r.tri_mt,
      }));

      // Calcular evolução
      let evolucao = null;
      if (historico.length >= 2) {
        const primeiro = historico[0];
        const ultimo = historico[historico.length - 1];
        evolucao = {
          acertos: (ultimo.acertos || 0) - (primeiro.acertos || 0),
          tri_lc: (ultimo.tri_lc || 0) - (primeiro.tri_lc || 0),
          tri_ch: (ultimo.tri_ch || 0) - (primeiro.tri_ch || 0),
          tri_cn: (ultimo.tri_cn || 0) - (primeiro.tri_cn || 0),
          tri_mt: (ultimo.tri_mt || 0) - (primeiro.tri_mt || 0),
        };
      }

      // Último resultado
      const ultimo = results[results.length - 1];

      res.json({
        aluno,
        posicao: { atual: posicao, total: totalTurma },
        ultimoResultado: {
          acertos: ultimo.correct_answers,
          tri_lc: ultimo.tri_lc,
          tri_ch: ultimo.tri_ch,
          tri_cn: ultimo.tri_cn,
          tri_mt: ultimo.tri_mt,
        },
        mediaTurma,
        historico,
        evolucao,
        totalProvas: historico.length,
      });

    } catch (error: any) {
      console.error("[ESCOLA ALUNO HISTORICO] Erro:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/escola/series - Lista de séries disponíveis
  // PROTEGIDO: Apenas school_admin e super_admin
  app.get("/api/escola/series", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const { data: answers, error } = await supabaseAdmin
        .from("student_answers")
        .select("turma")
        .not("turma", "is", null);

      if (error) throw error;

      const extractSerie = (turma: string): string => {
        const match = turma.match(/^(\d+ª?\s*[Ss]érie|\d+º?\s*[Aa]no)/i);
        return match ? match[1] : turma;
      };

      const seriesMap: Record<string, Set<string>> = {};

      (answers || []).forEach((r: any) => {
        if (r.turma) {
          const serie = extractSerie(r.turma);
          if (!seriesMap[serie]) {
            seriesMap[serie] = new Set();
          }
          seriesMap[serie].add(r.turma);
        }
      });

      const series = Object.entries(seriesMap).map(([serie, turmas]) => ({
        serie,
        turmas: Array.from(turmas).sort(),
      })).sort((a, b) => a.serie.localeCompare(b.serie));

      res.json({ series });

    } catch (error: any) {
      console.error("[ESCOLA SERIES] Erro:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // PLANO DE ESTUDOS PERSONALIZADO POR TRI
  // ============================================================================

  // Função auxiliar para determinar faixa TRI
  function getTriFaixa(triScore: number): 'baixo' | 'medio' | 'alto' {
    if (triScore < 500) return 'baixo';
    if (triScore < 650) return 'medio';
    return 'alto';
  }

  // GET /api/student/study-plan/:studentId/:examId - Buscar/Gerar plano de estudos
  // PROTEGIDO: Alunos podem ver seus próprios dados, admins podem ver todos
  app.get("/api/student/study-plan/:studentId/:examId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { studentId, examId } = req.params;

      // 1. Buscar student_number do profile (studentId = profile.id)
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("student_number")
        .eq("id", studentId)
        .single();

      // 2. Buscar TRI do aluno por área usando student_number OU student_id
      let studentResult = null;
      let studentError = null;

      if (profile?.student_number) {
        // Buscar por student_number (mais confiável)
        const result = await supabaseAdmin
          .from("student_answers")
          .select("tri_score, tri_lc, tri_ch, tri_cn, tri_mt, student_name, student_number")
          .eq("student_number", profile.student_number)
          .eq("exam_id", examId)
          .single();
        studentResult = result.data;
        studentError = result.error;
      }

      // Fallback: tentar por student_id
      if (!studentResult) {
        const result = await supabaseAdmin
          .from("student_answers")
          .select("tri_score, tri_lc, tri_ch, tri_cn, tri_mt, student_name, student_number")
          .eq("student_id", studentId)
          .eq("exam_id", examId)
          .single();
        studentResult = result.data;
        studentError = result.error;
      }

      if (studentError || !studentResult) {
        return res.status(404).json({ error: "Resultado do aluno não encontrado" });
      }

      const areas = [
        { code: 'LC', name: 'Linguagens', tri: studentResult.tri_lc },
        { code: 'CH', name: 'Ciências Humanas', tri: studentResult.tri_ch },
        { code: 'CN', name: 'Ciências da Natureza', tri: studentResult.tri_cn },
        { code: 'MT', name: 'Matemática', tri: studentResult.tri_mt }
      ];

      const studyPlan: Array<{
        area: string;
        areaName: string;
        tri_atual: number;
        tri_faixa: string;
        conteudos_prioritarios: Array<{ conteudo: string; habilidade: string; tri_score: number }>;
        listas_recomendadas: Array<{
          id: string;
          titulo: string;
          ordem: number;
          arquivo_url: string;
          arquivo_nome: string;
          arquivo_tipo: string;
          status: 'available' | 'locked' | 'mastered';
          tri_min: number;
          tri_max: number;
        }>;
        listas_proximas: Array<{
          id: string;
          titulo: string;
          tri_min: number;
          tri_max: number;
          pontos_para_desbloquear: number;
        }>;
        meta_proxima_faixa: { pontos_necessarios: number; proxima_faixa: string };
      }> = [];

      for (const area of areas) {
        if (!area.tri) continue;

        const triFaixa = getTriFaixa(area.tri);

        // 2. Buscar conteúdos prioritários para a faixa atual
        // Prioriza conteúdos que o aluno DEVERIA saber mas ainda não domina
        // Para subir de faixa, focar nos conteúdos da faixa atual e logo acima
        const targetTRI = area.tri + 50; // Buscar conteúdos até 50 pontos acima

        const { data: conteudos } = await supabaseAdmin
          .from("study_contents")
          .select("conteudo, habilidade, tri_score")
          .eq("area", area.code)
          .gte("tri_score", area.tri - 30) // Desde um pouco abaixo do TRI atual
          .lte("tri_score", targetTRI) // Até a meta
          .order("tri_score", { ascending: true })
          .limit(10);

        // 3. Buscar TODAS as listas de exercícios da área para mostrar com status
        const { data: todasListas, error: listasError } = await supabaseAdmin
          .from("exercise_lists")
          .select("id, titulo, ordem, tri_min, tri_max, arquivo_url, arquivo_nome, arquivo_tipo")
          .eq("area", area.code)
          .order("tri_min", { ascending: true })
          .order("ordem", { ascending: true });

        if (listasError) {
          console.error(`[Study Plan] Erro ao buscar listas para ${area.code}:`, listasError.message);
        }

        // Classificar listas por status baseado no TRI do aluno
        // Status: 'available' (TRI do aluno está na faixa), 'locked' (faixa superior), 'completed' (faixa inferior já dominada)
        const listasComStatus = (todasListas || []).map(l => {
          let status: 'available' | 'locked' | 'mastered' = 'locked';

          // Se o TRI do aluno está dentro da faixa da lista, está disponível
          if (area.tri >= l.tri_min - 50 && area.tri <= l.tri_max + 50) {
            status = 'available';
          }
          // Se o TRI do aluno está ACIMA da faixa, já "dominou" esse nível
          else if (area.tri > l.tri_max + 50) {
            status = 'mastered';
          }
          // Se o TRI do aluno está ABAIXO, está bloqueada (precisa evoluir)
          else {
            status = 'locked';
          }

          return {
            id: l.id,
            titulo: l.titulo,
            ordem: l.ordem,
            tri_min: l.tri_min,
            tri_max: l.tri_max,
            arquivo_url: l.arquivo_url,
            arquivo_nome: l.arquivo_nome,
            arquivo_tipo: l.arquivo_tipo,
            status,
            // Quantos pontos faltam para desbloquear (se locked)
            pontos_para_desbloquear: status === 'locked' ? Math.max(0, l.tri_min - 50 - area.tri) : 0
          };
        });

        // Separar em categorias para o frontend
        const listasDisponiveis = listasComStatus.filter(l => l.status === 'available');
        const listasProximas = listasComStatus.filter(l => l.status === 'locked').slice(0, 3); // Mostrar até 3 próximas

        // Determinar meta da próxima faixa
        let metaProximaFaixa = 500;
        let proximaFaixaLabel = 'Na média';
        if (area.tri >= 500) { metaProximaFaixa = 650; proximaFaixaLabel = 'Acima da média'; }
        if (area.tri >= 650) { metaProximaFaixa = 750; proximaFaixaLabel = 'Excelente'; }
        if (area.tri >= 750) { metaProximaFaixa = 850; proximaFaixaLabel = 'Excepcional'; }

        const pontosNecessarios = Math.max(0, Math.round(metaProximaFaixa - area.tri));

        studyPlan.push({
          area: area.code,
          areaName: area.name,
          tri_atual: area.tri,
          tri_faixa: triFaixa,
          conteudos_prioritarios: conteudos || [],
          // Listas disponíveis (para manter compatibilidade)
          listas_recomendadas: listasDisponiveis.map(l => ({
            id: l.id,
            titulo: l.titulo,
            ordem: l.ordem,
            arquivo_url: l.arquivo_url,
            arquivo_nome: l.arquivo_nome,
            arquivo_tipo: l.arquivo_tipo,
            status: l.status,
            tri_min: l.tri_min,
            tri_max: l.tri_max
          })),
          // Próximas listas bloqueadas (incentivo para evoluir)
          listas_proximas: listasProximas.map(l => ({
            id: l.id,
            titulo: l.titulo,
            tri_min: l.tri_min,
            tri_max: l.tri_max,
            pontos_para_desbloquear: l.pontos_para_desbloquear
          })),
          meta_proxima_faixa: {
            pontos_necessarios: pontosNecessarios,
            proxima_faixa: proximaFaixaLabel
          }
        });
      }

      // 4. Salvar/Atualizar plano no banco (para histórico) - opcional
      try {
        for (const plan of studyPlan) {
          await supabaseAdmin
            .from("student_study_plans")
            .upsert({
              student_id: studentId,
              student_number: studentResult.student_number,
              exam_id: examId,
              area: plan.area,
              tri_atual: plan.tri_atual,
              tri_faixa: plan.tri_faixa,
              conteudos_prioritarios: plan.conteudos_prioritarios,
              listas_recomendadas: plan.listas_recomendadas.map(l => l.id),
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'student_id,exam_id,area'
            });
        }
      } catch (saveError) {
        // Ignorar erro de salvar histórico - não é crítico
        console.log("[STUDY_PLAN] Aviso: Não foi possível salvar histórico do plano");
      }

      res.json({
        success: true,
        studentName: studentResult.student_name,
        triGeral: studentResult.tri_score,
        studyPlan
      });

    } catch (error: any) {
      console.error("[STUDY_PLAN] Erro:", error);
      res.status(500).json({
        error: "Erro ao gerar plano de estudos",
        details: error.message
      });
    }
  });

  // GET /api/student/exercise-lists/:studentId - Buscar listas liberadas para o aluno
  // PROTEGIDO: Apenas o próprio aluno ou admins
  app.get("/api/student/exercise-lists/:studentId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { studentId } = req.params;

      // Buscar listas liberadas para o aluno
      const { data: releases, error } = await supabaseAdmin
        .from("student_list_releases")
        .select(`
          id,
          released_at,
          downloaded_at,
          download_count,
          exercise_lists (
            id,
            area,
            tri_min,
            tri_max,
            titulo,
            arquivo_nome,
            arquivo_tipo,
            tamanho_bytes,
            ordem
          )
        `)
        .eq("student_id", studentId)
        .order("released_at", { ascending: false });

      if (error) {
        console.error("[EXERCISE_LISTS] Erro:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({
        success: true,
        releases: releases || []
      });

    } catch (error: any) {
      console.error("[EXERCISE_LISTS] Erro:", error);
      res.status(500).json({
        error: "Erro ao buscar listas de exercícios",
        details: error.message
      });
    }
  });

  // GET /api/student/exercise-lists/:studentId/download/:listId - Download de lista
  // PROTEGIDO: Apenas o próprio aluno ou admins
  app.get("/api/student/exercise-lists/:studentId/download/:listId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { studentId, listId } = req.params;

      // 1. Verificar se a lista está liberada para o aluno
      const { data: release, error: releaseError } = await supabaseAdmin
        .from("student_list_releases")
        .select("id")
        .eq("student_id", studentId)
        .eq("exercise_list_id", listId)
        .single();

      if (releaseError || !release) {
        return res.status(403).json({ error: "Lista não liberada para este aluno" });
      }

      // 2. Buscar dados da lista
      const { data: list, error: listError } = await supabaseAdmin
        .from("exercise_lists")
        .select("arquivo_url, arquivo_nome")
        .eq("id", listId)
        .single();

      if (listError || !list) {
        return res.status(404).json({ error: "Lista não encontrada" });
      }

      // 3. Atualizar contador de downloads
      await supabaseAdmin
        .from("student_list_releases")
        .update({
          downloaded_at: new Date().toISOString(),
          download_count: supabaseAdmin.rpc('increment', { row_id: release.id })
        })
        .eq("id", release.id);

      // 4. Retornar URL do arquivo
      res.json({
        success: true,
        downloadUrl: list.arquivo_url,
        fileName: list.arquivo_nome
      });

    } catch (error: any) {
      console.error("[DOWNLOAD] Erro:", error);
      res.status(500).json({
        error: "Erro ao processar download",
        details: error.message
      });
    }
  });

  // POST /api/admin/release-lists - Liberar listas para alunos (admin)
  // 🔒 PROTECTED: Requer autenticação + role admin
  app.post("/api/admin/release-lists", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    try {
      const { studentIds, listIds } = req.body;

      if (!studentIds?.length || !listIds?.length) {
        return res.status(400).json({ error: "studentIds e listIds são obrigatórios" });
      }

      const releases = [];
      for (const studentId of studentIds) {
        for (const listId of listIds) {
          releases.push({
            student_id: studentId,
            exercise_list_id: listId
          });
        }
      }

      const { data, error } = await supabaseAdmin
        .from("student_list_releases")
        .upsert(releases, { onConflict: 'student_id,exercise_list_id' })
        .select();

      if (error) {
        console.error("[RELEASE_LISTS] Erro:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({
        success: true,
        releasedCount: data?.length || 0
      });

    } catch (error: any) {
      console.error("[RELEASE_LISTS] Erro:", error);
      res.status(500).json({
        error: "Erro ao liberar listas",
        details: error.message
      });
    }
  });

  // GET /api/study-contents - Listar conteúdos de estudo (para admin/debug)
  app.get("/api/study-contents", async (req: Request, res: Response) => {
    try {
      const { area, tri_faixa, limit = 100 } = req.query;

      let query = supabaseAdmin
        .from("study_contents")
        .select("*")
        .order("tri_score", { ascending: true })
        .limit(Number(limit));

      if (area) query = query.eq("area", area as string);
      if (tri_faixa) query = query.eq("tri_faixa", tri_faixa as string);

      const { data, error, count } = await query;

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      res.json({ success: true, contents: data, count });

    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/exercise-lists - Listar todas as listas (para admin)
  app.get("/api/exercise-lists", async (req: Request, res: Response) => {
    try {
      const { area } = req.query;

      let query = supabaseAdmin
        .from("exercise_lists")
        .select("*")
        .order("area")
        .order("tri_min")
        .order("ordem");

      if (area) query = query.eq("area", area as string);

      const { data, error } = await query;

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      res.json({ success: true, lists: data });

    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // CRUD ESCOLAS (SUPER_ADMIN ONLY)
  // ============================================================================

  // GET /api/schools - Lista todas as escolas
  // PROTEGIDO: super_admin vê todas, school_admin vê a sua
  app.get("/api/schools", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const profile = (req as AuthenticatedRequest).profile;

      let query = supabaseAdmin
        .from("schools")
        .select("*")
        .order("name");

      // Se for school_admin, filtrar apenas a sua escola
      if (profile?.role === 'school_admin') {
        if (!profile.school_id) {
          return res.json({ success: true, schools: [] });
        }
        query = query.eq('id', profile.school_id);
      }

      const { data, error } = await query;

      if (error) throw error;

      res.json({ success: true, schools: data || [] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/schools/:id - Buscar escola por ID
  // PROTEGIDO: Apenas super_admin ou school_admin da escola
  app.get("/api/schools/:id", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const { data, error } = await supabaseAdmin
        .from("schools")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;

      res.json({ success: true, school: data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/schools - Criar escola
  // PROTEGIDO: Apenas super_admin pode criar escolas
  app.post("/api/schools", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
    try {
      const { name, slug } = req.body;

      if (!name) {
        return res.status(400).json({ error: "Nome da escola é obrigatório" });
      }

      // Gerar slug automaticamente se não fornecido
      const schoolSlug = slug || name.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      const { data, error } = await supabaseAdmin
        .from("schools")
        .insert({
          name,
          slug: schoolSlug
        })
        .select()
        .single();

      if (error) throw error;

      res.json({ success: true, school: data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/schools/:id - Atualizar escola
  // PROTEGIDO: Apenas super_admin pode atualizar escolas
  app.put("/api/schools/:id", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, slug } = req.body;

      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (slug !== undefined) updates.slug = slug;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "Nenhum campo para atualizar" });
      }

      const { data, error } = await supabaseAdmin
        .from("schools")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      res.json({ success: true, school: data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/schools/:id - Excluir escola (CASCADE: remove provas, respostas e alunos vinculados)
  // PROTEGIDO: Apenas super_admin pode excluir escolas
  app.delete("/api/schools/:id", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      console.log(`[DELETE SCHOOL] Iniciando exclusão em cascata da escola ${id}`);

      // 1. Buscar todos os exams da escola
      const { data: exams } = await supabaseAdmin
        .from("exams")
        .select("id")
        .eq("school_id", id);

      const examIds = exams?.map(e => e.id) || [];

      // 2. Deletar student_answers de todos os exams
      if (examIds.length > 0) {
        const { error: answersError } = await supabaseAdmin
          .from("student_answers")
          .delete()
          .in("exam_id", examIds);

        if (answersError) {
          console.error("[DELETE SCHOOL] Erro ao deletar respostas:", answersError);
        } else {
          console.log(`[DELETE SCHOOL] Respostas dos ${examIds.length} simulados removidas`);
        }
      }

      // 3. Deletar todos os exams da escola
      if (examIds.length > 0) {
        const { error: examsError } = await supabaseAdmin
          .from("exams")
          .delete()
          .eq("school_id", id);

        if (examsError) {
          console.error("[DELETE SCHOOL] Erro ao deletar simulados:", examsError);
        } else {
          console.log(`[DELETE SCHOOL] ${examIds.length} simulados removidos`);
        }
      }

      // 4. Deletar alunos vinculados à escola (Auth + Profile)
      const { data: students } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("school_id", id)
        .eq("role", "student");

      if (students && students.length > 0) {
        for (const student of students) {
          // Deletar Auth user (ignora erro se não existir)
          await supabaseAdmin.auth.admin.deleteUser(student.id).catch(() => { });
        }

        // Deletar profiles
        const { error: profilesError } = await supabaseAdmin
          .from("profiles")
          .delete()
          .eq("school_id", id)
          .eq("role", "student");

        if (profilesError) {
          console.error("[DELETE SCHOOL] Erro ao deletar alunos:", profilesError);
        } else {
          console.log(`[DELETE SCHOOL] ${students.length} alunos removidos`);
        }
      }

      // 5. Finalmente deletar a escola
      const { error } = await supabaseAdmin
        .from("schools")
        .delete()
        .eq("id", id);

      if (error) throw error;

      console.log(`[DELETE SCHOOL] ✅ Escola ${id} excluída com sucesso`);

      res.json({
        success: true,
        message: "Escola excluída com sucesso",
        deleted: {
          exams: examIds.length,
          students: students?.length || 0
        }
      });
    } catch (error: any) {
      console.error("[DELETE SCHOOL] Erro:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/schools/:id/stats - Estatísticas da escola
  // PROTEGIDO: Apenas admins
  app.get("/api/schools/:id/stats", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Buscar total de alunos
      const { count: totalAlunos } = await supabaseAdmin
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("school_id", id)
        .eq("role", "student");

      // Buscar total de simulados
      const { count: totalSimulados } = await supabaseAdmin
        .from("exams")
        .select("*", { count: "exact", head: true })
        .eq("school_id", id);

      // Buscar média TRI
      const { data: triData } = await supabaseAdmin
        .from("student_answers")
        .select("tri_score")
        .eq("school_id", id)
        .not("tri_score", "is", null);

      const triMedia = triData && triData.length > 0
        ? triData.reduce((sum, r) => sum + (r.tri_score || 0), 0) / triData.length
        : 0;

      res.json({
        success: true,
        stats: {
          totalAlunos: totalAlunos || 0,
          totalSimulados: totalSimulados || 0,
          triMedia: triMedia.toFixed(1)
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // CRUD SIMULADOS (vinculados a escolas)
  // ============================================================================

  // GET /api/simulados - Lista simulados (filtrado por school_id se fornecido)
  // PROTEGIDO: Apenas admins
  app.get("/api/simulados", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const { school_id } = req.query;

      let query = supabaseAdmin
        .from("exams")
        .select(`
          *,
          schools:school_id (id, name)
        `)
        .order("created_at", { ascending: false });

      if (school_id) {
        query = query.eq("school_id", school_id as string);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Buscar contagem de alunos por simulado
      const simuladosWithStats = await Promise.all((data || []).map(async (exam) => {
        const { count } = await supabaseAdmin
          .from("student_answers")
          .select("*", { count: "exact", head: true })
          .eq("exam_id", exam.id);

        return {
          ...exam,
          alunos_count: count || 0
        };
      }));

      res.json({ success: true, simulados: simuladosWithStats });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/simulados - Criar simulado vinculado a escola
  // PROTEGIDO: Apenas admins
  app.post("/api/simulados", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const { school_id, title, template_type, total_questions, answer_key } = req.body;

      if (!school_id || !title) {
        return res.status(400).json({ error: "school_id e title são obrigatórios" });
      }

      const { data, error } = await supabaseAdmin
        .from("exams")
        .insert({
          school_id,
          title,
          template_type: template_type || "ENEM",
          total_questions: total_questions || 90,
          answer_key: answer_key || null,
          status: "active"
        })
        .select()
        .single();

      if (error) throw error;

      res.json({ success: true, simulado: data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/simulados/:id - Atualizar simulado
  // PROTEGIDO: Apenas admins
  app.put("/api/simulados/:id", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { title, template_type, total_questions, applied_at, status, answer_key } = req.body;

      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (template_type !== undefined) updates.template_type = template_type;
      if (total_questions !== undefined) updates.total_questions = total_questions;
      if (applied_at !== undefined) updates.applied_at = applied_at;
      if (status !== undefined) updates.status = status;
      if (answer_key !== undefined) updates.answer_key = answer_key;

      const { data, error } = await supabaseAdmin
        .from("exams")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      res.json({ success: true, simulado: data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/simulados/:id/status - Atualizar status do simulado
  // PROTEGIDO: Apenas admins
  app.put("/api/simulados/:id/status", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!["pending", "in_progress", "completed"].includes(status)) {
        return res.status(400).json({ error: "Status inválido. Use: pending, in_progress, completed" });
      }

      const { data, error } = await supabaseAdmin
        .from("exams")
        .update({ status })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      res.json({ success: true, simulado: data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/simulados/:id - Deletar simulado (CASCADE: remove respostas vinculadas)
  // PROTEGIDO: Apenas admins
  app.delete("/api/simulados/:id", requireAuth, requireRole('super_admin', 'school_admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      console.log(`[DELETE SIMULADO] Iniciando exclusão em cascata do simulado ${id}`);

      // 1. Deletar todas as respostas vinculadas
      const { count: answersDeleted, error: answersError } = await supabaseAdmin
        .from("student_answers")
        .delete()
        .eq("exam_id", id)
        .select("*", { count: "exact", head: true });

      if (answersError) {
        console.error("[DELETE SIMULADO] Erro ao deletar respostas:", answersError);
      } else {
        console.log(`[DELETE SIMULADO] ${answersDeleted || 0} respostas removidas`);
      }

      // 2. Deletar o simulado
      const { error } = await supabaseAdmin
        .from("exams")
        .delete()
        .eq("id", id);

      if (error) throw error;

      console.log(`[DELETE SIMULADO] ✅ Simulado ${id} excluído com sucesso`);

      res.json({
        success: true,
        message: "Simulado excluído com sucesso",
        deleted: {
          answers: answersDeleted || 0
        }
      });
    } catch (error: any) {
      console.error("[DELETE SIMULADO] Erro:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ======================================== COORDINATOR MANAGEMENT ENDPOINTS ========================================

  interface CoordinatorInput {
    email: string;
    name: string;
    password: string;
    school_id: string;
    allowed_series: string[] | null; // null = full access
  }

  // POST /api/admin/coordinators - Create coordinator
  // PROTEGIDO: Apenas super_admin
  // Cria auth user primeiro, trigger cria profile básico, depois atualizamos profile
  app.post("/api/admin/coordinators", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
    let userId: string | null = null;

    try {
      const { email, name, password, school_id, allowed_series } = req.body as CoordinatorInput;

      if (!email || !name || !password || !school_id) {
        return res.status(400).json({ error: "Email, nome, senha e escola são obrigatórios" });
      }

      if (password.length < 8) {
        return res.status(400).json({ error: "Senha deve ter pelo menos 8 caracteres" });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Formato de email inválido" });
      }

      // Validate school exists
      const { data: school, error: schoolError } = await supabaseAdmin
        .from("schools")
        .select("id, name")
        .eq("id", school_id)
        .single();

      if (schoolError || !school) {
        return res.status(400).json({ error: "Escola não encontrada" });
      }

      // Check if email already exists in profiles
      const { data: existingProfile } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (existingProfile) {
        return res.status(400).json({ error: "Este email já está cadastrado" });
      }

      // Step 1: Create auth user
      // Trigger will create a basic profile (role=student by default)
      console.log("[COORDINATOR] Creating auth user...");
      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          name,
          role: "school_admin",
          school_id,
          allowed_series: allowed_series || null
        }
      });

      if (authError) {
        console.error("[COORDINATOR] Auth error:", authError.message);

        if (authError.message.includes("already been registered") || authError.message.includes("already exists")) {
          return res.status(400).json({ error: "Este email já está cadastrado" });
        }

        // If "Database error", the trigger might have failed
        // Check if user was created despite the error
        if (authError.message.includes("Database error")) {
          console.log("[COORDINATOR] Database error - checking if user exists...");

          // Wait a moment and check if user was created
          await new Promise(resolve => setTimeout(resolve, 500));

          const { data: checkUser } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("email", email)
            .maybeSingle();

          if (checkUser) {
            console.log("[COORDINATOR] User was created despite error:", checkUser.id);
            userId = checkUser.id;
          } else {
            return res.status(500).json({
              error: "Erro ao criar usuário",
              details: "O trigger do banco de dados falhou. Por favor, aplique a migration 20250113_fix_trigger_allowed_series.sql no Supabase SQL Editor."
            });
          }
        } else {
          return res.status(500).json({ error: "Erro ao criar usuário", details: authError.message });
        }
      }

      if (!userId) {
        if (!authUser?.user?.id) {
          return res.status(500).json({ error: "Auth user criado mas sem ID" });
        }
        userId = authUser.user.id;
      }

      console.log("[COORDINATOR] Auth user created:", userId);

      // Step 2: Update profile with coordinator data
      // The trigger may have created a basic profile, we need to update it
      console.log("[COORDINATOR] Updating profile with coordinator data...");

      // Give trigger time to finish
      await new Promise(resolve => setTimeout(resolve, 200));

      const { error: updateError } = await supabaseAdmin
        .from("profiles")
        .upsert({
          id: userId,
          email,
          name,
          role: "school_admin",
          school_id,
          allowed_series: allowed_series || null
        });

      if (updateError) {
        console.error("[COORDINATOR] Profile update error:", updateError.message);
        // Don't fail - user is created, profile might just need manual fix
      }

      console.log("[COORDINATOR] Coordinator created successfully:", userId);

      res.json({
        success: true,
        coordinator: { id: userId, email, name, school_id, allowed_series }
      });
    } catch (error) {
      console.error("[COORDINATOR] Error:", error);

      // Rollback auth user if created
      if (userId) {
        console.log("[COORDINATOR] Rolling back auth user:", userId);
        await supabaseAdmin.auth.admin.deleteUser(userId).catch(e =>
          console.error("[COORDINATOR] Auth rollback failed:", e)
        );
      }

      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      res.status(500).json({ error: "Erro interno ao criar coordenador", details: errorMessage });
    }
  });

  // GET /api/admin/coordinators - List coordinators
  // PROTEGIDO: Apenas super_admin
  app.get("/api/admin/coordinators", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
    try {
      const { school_id } = req.query;

      let query = supabaseAdmin
        .from("profiles")
        .select(`id, email, name, role, school_id, allowed_series, created_at, schools!profiles_school_id_fkey (id, name)`)
        .eq("role", "school_admin")
        .order("created_at", { ascending: false });

      if (school_id) {
        query = query.eq("school_id", school_id);
      }

      const { data: coordinators, error } = await query;

      if (error) {
        console.error("[COORDINATOR] List error:", error);
        return res.status(500).json({ error: "Erro ao listar coordenadores" });
      }

      res.json({ success: true, coordinators: coordinators || [] });
    } catch (error) {
      console.error("[COORDINATOR] Error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // PUT /api/admin/coordinators/:id - Update coordinator
  // PROTEGIDO: Apenas super_admin
  app.put("/api/admin/coordinators/:id", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, allowed_series, school_id } = req.body;

      const updates: Record<string, any> = {};
      if (name !== undefined) updates.name = name;
      if (allowed_series !== undefined) updates.allowed_series = allowed_series;
      if (school_id !== undefined) updates.school_id = school_id;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "Nenhum campo para atualizar" });
      }

      const { data: profile, error } = await supabaseAdmin
        .from("profiles")
        .update(updates)
        .eq("id", id)
        .eq("role", "school_admin")
        .select()
        .single();

      if (error || !profile) {
        return res.status(404).json({ error: "Coordenador não encontrado" });
      }

      // Update auth user metadata if name or school_id changed
      if (name || school_id) {
        const metadataUpdates: Record<string, string> = {};
        if (name) metadataUpdates.name = name;
        if (school_id) metadataUpdates.school_id = school_id;
        await supabaseAdmin.auth.admin.updateUserById(id, { user_metadata: metadataUpdates });
      }

      res.json({ success: true, coordinator: profile });
    } catch (error) {
      console.error("[COORDINATOR] Update error:", error);
      res.status(500).json({ error: "Erro ao atualizar coordenador" });
    }
  });

  // DELETE /api/admin/coordinators/:id - Delete coordinator
  // PROTEGIDO: Apenas super_admin
  // Deleta tanto do profiles quanto do auth.users
  app.delete("/api/admin/coordinators/:id", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", id)
        .single();

      if (!profile || profile.role !== "school_admin") {
        return res.status(404).json({ error: "Coordenador não encontrado" });
      }

      // Delete profile first (this is what matters for the application)
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .delete()
        .eq("id", id);

      if (profileError) {
        console.error("[COORDINATOR] Profile delete error:", profileError);
        return res.status(500).json({ error: "Erro ao excluir coordenador do banco" });
      }

      // Try to delete auth user (may fail if already deleted or inconsistent)
      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(id);

      if (authError) {
        // Log warning but don't fail - profile was already deleted successfully
        console.warn("[COORDINATOR] Auth delete warning (profile already deleted):", authError.message);
      }

      console.log("[COORDINATOR] Deleted coordinator:", id);
      res.json({ success: true });
    } catch (error) {
      console.error("[COORDINATOR] Error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // POST /api/admin/coordinators/:id/reset-password - Reset coordinator password
  // PROTEGIDO: Apenas super_admin
  app.post("/api/admin/coordinators/:id/reset-password", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { password } = req.body;

      if (!password || password.length < 8) {
        return res.status(400).json({ error: "Senha deve ter pelo menos 8 caracteres" });
      }

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("role, email")
        .eq("id", id)
        .single();

      if (!profile || profile.role !== "school_admin") {
        return res.status(404).json({ error: "Coordenador não encontrado" });
      }

      const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { password });

      if (error) {
        return res.status(500).json({ error: "Erro ao resetar senha" });
      }

      res.json({ success: true, email: profile.email });
    } catch (error) {
      console.error("[COORDINATOR] Reset password error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // ============================================================
  // ANSWER SHEET BATCHES - Gabaritos com QR Code
  // ============================================================

  /**
   * POST /api/answer-sheet-batches
   * Cria um novo lote de gabaritos a partir de CSV
   *
   * Body (multipart/form-data):
   * - csv: arquivo CSV com alunos (colunas: nome, matricula, turma)
   * - school_id: ID da escola
   * - exam_id: ID do simulado/prova
   * - batch_name: Nome do lote (ex: "Simulado ENEM - Março 2025")
   */
  app.post("/api/answer-sheet-batches", uploadCsv.single("csv"), async (req: Request, res: Response) => {
    try {
      const { school_id, exam_id, batch_name } = req.body;

      // Validações
      if (!req.file) {
        return res.status(400).json({ error: "Arquivo CSV não fornecido" });
      }

      if (!school_id || !exam_id || !batch_name) {
        return res.status(400).json({
          error: "Campos obrigatórios: school_id, exam_id, batch_name"
        });
      }

      // Ler e processar CSV
      const csvContent = req.file.buffer.toString("utf-8");
      const students = parseStudentCSV(csvContent);

      if (students.length === 0) {
        return res.status(400).json({ error: "CSV vazio ou sem alunos válidos" });
      }

      // Criar batch no Supabase
      const result = await createAnswerSheetBatch(school_id, exam_id, batch_name, students);

      console.log(`[BATCH] Lote criado: ${result.batch.id} com ${result.students.length} alunos`);

      res.json({
        success: true,
        batch: result.batch,
        students_count: result.students.length,
        students: result.students.map(s => ({
          id: s.id,
          student_name: s.student_name,
          sheet_code: s.sheet_code,
          enrollment_code: s.enrollment_code,
          class_name: s.class_name,
        })),
      });
    } catch (error: any) {
      console.error("[BATCH] Erro ao criar lote:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/answer-sheet-batches/:batchId
   * Retorna detalhes de um lote
   */
  app.get("/api/answer-sheet-batches/:batchId", async (req: Request, res: Response) => {
    try {
      const { batchId } = req.params;

      const batch = await getBatchById(batchId);
      if (!batch) {
        return res.status(404).json({ error: "Lote não encontrado" });
      }

      const students = await getStudentsByBatchId(batchId);

      res.json({
        batch,
        students_count: students.length,
        students,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/answer-sheet-batches/:batchId/pdf
   * Gera e retorna PDF com gabaritos do lote
   */
  app.get("/api/answer-sheet-batches/:batchId/pdf", async (req: Request, res: Response) => {
    try {
      const { batchId } = req.params;

      // Buscar lote
      const batch = await getBatchById(batchId);
      if (!batch) {
        return res.status(404).json({ error: "Lote não encontrado" });
      }

      // Buscar alunos
      const students = await getStudentsByBatchId(batchId);
      if (students.length === 0) {
        return res.status(400).json({ error: "Lote sem alunos" });
      }

      // Buscar nome do simulado
      const { data: exam } = await supabaseAdmin
        .from("exams")
        .select("title")
        .eq("id", batch.exam_id)
        .single();

      const examName = exam?.title || batch.name;

      console.log(`[PDF] Gerando PDF para lote ${batchId} com ${students.length} alunos`);

      // Gerar PDF
      const pdfBuffer = await generateBatchPDF(students, examName);

      // Enviar PDF
      const filename = `gabaritos_${batch.name.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);

      console.log(`[PDF] PDF gerado: ${filename} (${pdfBuffer.length} bytes)`);
    } catch (error: any) {
      console.error("[PDF] Erro ao gerar PDF:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/answer-sheet-students/:sheetCode
   * Busca aluno por sheet_code (QR Code)
   */
  app.get("/api/answer-sheet-students/:sheetCode", async (req: Request, res: Response) => {
    try {
      const { sheetCode } = req.params;

      const student = await getStudentBySheetCode(sheetCode);
      if (!student) {
        return res.status(404).json({ error: "Código não encontrado" });
      }

      res.json(student);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/answer-sheet-students/:sheetCode/answers
   * Salva respostas de um aluno (chamado após leitura OMR)
   *
   * Body:
   * - answers: array de respostas ["A", "B", null, "C", ...]
   */
  app.post("/api/answer-sheet-students/:sheetCode/answers", async (req: Request, res: Response) => {
    try {
      const { sheetCode } = req.params;
      const { answers } = req.body;

      if (!answers || !Array.isArray(answers)) {
        return res.status(400).json({ error: "Campo 'answers' deve ser um array" });
      }

      // Verificar se aluno existe
      const student = await getStudentBySheetCode(sheetCode);
      if (!student) {
        return res.status(404).json({ error: "Código não encontrado" });
      }

      // Atualizar respostas
      const updated = await updateStudentAnswers(sheetCode, answers);

      console.log(`[ANSWERS] Respostas salvas para ${sheetCode}: ${answers.filter(a => a).length}/90`);

      res.json({
        success: true,
        student: updated,
      });
    } catch (error: any) {
      console.error("[ANSWERS] Erro ao salvar respostas:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/process-sheet-with-qr
   * Processa gabarito: lê QR + OMR e salva respostas
   * Endpoint conveniente que faz tudo em uma chamada
   *
   * Body (multipart/form-data):
   * - image: imagem do gabarito escaneado
   */
  app.post("/api/process-sheet-with-qr", upload.single("image"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Imagem não fornecida" });
      }

      // 1. Enviar para API OMR com QR
      const axios = (await import("axios")).default;
      const FormData = (await import("form-data")).default;

      const formData = new FormData();
      formData.append("image", req.file.buffer, {
        filename: "scan.png",
        contentType: req.file.mimetype,
      });

      const omrUrl = `${PYTHON_OMR_SERVICE_URL}/api/process-sheet`;
      console.log(`[PROCESS] Enviando imagem para OMR: ${omrUrl}`);

      const omrResponse = await axios.post(omrUrl, formData, {
        headers: formData.getHeaders(),
        timeout: 60000,
      });

      const omrResult = omrResponse.data;

      if (omrResult.status !== "sucesso") {
        return res.status(400).json({
          error: omrResult.message || "Erro no processamento OMR",
          code: omrResult.code,
        });
      }

      const { sheet_code, answers, stats } = omrResult;

      // 2. Buscar aluno no Supabase
      const student = await getStudentBySheetCode(sheet_code);
      if (!student) {
        return res.status(404).json({
          error: `Código ${sheet_code} não encontrado no sistema`,
          code: "STUDENT_NOT_FOUND",
          sheet_code,
        });
      }

      // 3. Salvar respostas
      const updated = await updateStudentAnswers(sheet_code, answers);

      console.log(`[PROCESS] Processado: ${sheet_code} - ${student.student_name} - ${stats.answered}/90 respostas`);

      res.json({
        success: true,
        sheet_code,
        student: {
          id: student.id,
          student_name: student.student_name,
          enrollment_code: student.enrollment_code,
          class_name: student.class_name,
        },
        answers,
        stats,
        processed_at: updated?.processed_at,
      });
    } catch (error: any) {
      console.error("[PROCESS] Erro:", error.response?.data || error.message);

      // Tratar erros da API OMR
      if (error.response?.data) {
        return res.status(error.response.status || 500).json(error.response.data);
      }

      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // TRACKING DE DOWNLOADS DE LISTAS
  // ============================================================================

  // Endpoint para registrar download de lista pelo aluno
  app.post("/api/list-downloads", requireAuth, async (req: Request, res: Response) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const { listId } = req.body;

      if (!listId) {
        return res.status(400).json({ error: "listId é obrigatório" });
      }

      // Buscar dados do aluno
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("id, school_id, turma, role")
        .eq("id", authReq.user.id)
        .single();

      if (profileError || !profile) {
        return res.status(404).json({ error: "Perfil não encontrado" });
      }

      if (profile.role !== "student") {
        return res.status(403).json({ error: "Apenas alunos podem registrar downloads" });
      }

      // Verificar se a lista existe
      const { data: list, error: listError } = await supabaseAdmin
        .from("exercise_lists")
        .select("id")
        .eq("id", listId)
        .single();

      if (listError || !list) {
        return res.status(404).json({ error: "Lista não encontrada" });
      }

      // Registrar download (upsert para evitar duplicatas)
      const { data: download, error: downloadError } = await supabaseAdmin
        .from("list_downloads")
        .upsert({
          student_id: profile.id,
          list_id: listId,
          school_id: profile.school_id,
          turma: profile.turma,
          downloaded_at: new Date().toISOString(),
        }, {
          onConflict: "student_id,list_id",
          ignoreDuplicates: false, // Atualiza downloaded_at se já existir
        })
        .select()
        .single();

      if (downloadError) {
        console.error("[LIST_DOWNLOAD] Erro ao registrar:", downloadError);
        return res.status(500).json({ error: "Erro ao registrar download" });
      }

      res.json({ success: true, download });
    } catch (error: any) {
      console.error("[LIST_DOWNLOAD] Erro:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Endpoint para coordenador ver relatório de downloads
  app.get("/api/coordinator/list-downloads", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const { turma, area, listId, onlyMissing } = req.query;

      // Buscar school_id do coordenador
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("school_id, role")
        .eq("id", authReq.user.id)
        .single();

      if (profileError || !profile) {
        return res.status(404).json({ error: "Perfil não encontrado" });
      }

      const schoolId = profile.school_id;

      // Buscar todas as listas disponíveis (com filtro opcional de área)
      let listas: any[] = [];
      try {
        let listasQuery = supabaseAdmin
          .from("exercise_lists")
          .select("id, titulo, area, tri_min, tri_max, ordem");

        if (area) {
          listasQuery = listasQuery.eq("area", area);
        }

        if (listId) {
          listasQuery = listasQuery.eq("id", listId);
        }

        const { data: listasData, error: listasError } = await listasQuery.order("area").order("tri_min").order("ordem");

        if (listasError) {
          console.warn("[COORDINATOR_DOWNLOADS] Tabela exercise_lists não encontrada ou erro:", listasError.message);
          listas = [];
        } else {
          listas = listasData || [];
        }
      } catch (err: any) {
        console.warn("[COORDINATOR_DOWNLOADS] Erro ao buscar listas:", err.message);
        listas = [];
      }

      // Buscar todos os alunos da escola (com filtro opcional de turma)
      let alunosQuery = supabaseAdmin
        .from("profiles")
        .select("id, name, student_number, turma")
        .eq("role", "student")
        .eq("school_id", schoolId);

      if (turma) {
        alunosQuery = alunosQuery.eq("turma", turma);
      }

      const { data: alunos, error: alunosError } = await alunosQuery.order("name");

      if (alunosError) {
        return res.status(500).json({ error: "Erro ao buscar alunos" });
      }

      // Buscar todos os downloads da escola
      let downloads: any[] = [];
      try {
        let downloadsQuery = supabaseAdmin
          .from("list_downloads")
          .select("student_id, list_id, downloaded_at")
          .eq("school_id", schoolId);

        if (turma) {
          downloadsQuery = downloadsQuery.eq("turma", turma);
        }

        const { data: downloadsData, error: downloadsError } = await downloadsQuery;

        if (downloadsError) {
          // Se a tabela não existe, retornar lista vazia (feature não habilitada)
          console.warn("[COORDINATOR_DOWNLOADS] Tabela list_downloads não encontrada ou erro:", downloadsError.message);
          downloads = [];
        } else {
          downloads = downloadsData || [];
        }
      } catch (err: any) {
        console.warn("[COORDINATOR_DOWNLOADS] Erro ao buscar downloads:", err.message);
        downloads = [];
      }

      // Criar mapa de downloads para busca rápida
      const downloadMap = new Map<string, string>(); // key: "studentId-listId", value: downloaded_at
      for (const d of downloads || []) {
        downloadMap.set(`${d.student_id}-${d.list_id}`, d.downloaded_at);
      }

      // Montar relatório por lista
      const report = (listas || []).map(lista => {
        const alunosStatus = (alunos || []).map(aluno => {
          const downloadedAt = downloadMap.get(`${aluno.id}-${lista.id}`);
          return {
            studentId: aluno.id,
            studentName: aluno.name,
            studentNumber: aluno.student_number,
            turma: aluno.turma,
            downloaded: !!downloadedAt,
            downloadedAt: downloadedAt || null,
          };
        });

        // Filtrar apenas quem não baixou se solicitado
        const filteredAlunos = onlyMissing === "true"
          ? alunosStatus.filter(a => !a.downloaded)
          : alunosStatus;

        const totalAlunos = alunosStatus.length;
        const totalDownloads = alunosStatus.filter(a => a.downloaded).length;

        return {
          listId: lista.id,
          listTitle: lista.titulo,
          area: lista.area,
          triMin: lista.tri_min,
          triMax: lista.tri_max,
          totalAlunos,
          totalDownloads,
          percentDownloaded: totalAlunos > 0 ? Math.round((totalDownloads / totalAlunos) * 100) : 0,
          alunos: filteredAlunos,
        };
      });

      // Resumo geral
      const summary = {
        totalListas: report.length,
        totalAlunos: alunos?.length || 0,
        mediaDownloads: report.length > 0
          ? Math.round(report.reduce((acc, r) => acc + r.percentDownloaded, 0) / report.length)
          : 0,
      };

      res.json({ success: true, summary, report });
    } catch (error: any) {
      console.error("[COORDINATOR_DOWNLOADS] Erro:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Endpoint para buscar turmas disponíveis (para filtro)
  app.get("/api/coordinator/turmas", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
    try {
      const authReq = req as AuthenticatedRequest;

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("school_id")
        .eq("id", authReq.user.id)
        .single();

      if (!profile?.school_id) {
        return res.status(404).json({ error: "Escola não encontrada" });
      }

      const { data: turmas, error } = await supabaseAdmin
        .from("profiles")
        .select("turma")
        .eq("school_id", profile.school_id)
        .eq("role", "student")
        .not("turma", "is", null);

      if (error) {
        return res.status(500).json({ error: "Erro ao buscar turmas" });
      }

      // Extrair turmas únicas
      const uniqueTurmas = [...new Set((turmas || []).map(t => t.turma).filter(Boolean))].sort();

      res.json({ success: true, turmas: uniqueTurmas });
    } catch (error: any) {
      console.error("[COORDINATOR_TURMAS] Erro:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
