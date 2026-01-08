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
import { extractHeaderInfoWithGPT } from "./chatgptOMR.js";
import { registerDebugRoutes } from "./debugRoutes.js";
import { gerarAnaliseDetalhada } from "./conteudosLoader.js";
import { storage } from "./storage.js";
import { supabaseAdmin } from "./lib/supabase.js";
import {
  transformStudentsForSupabase,
  transformStudentFromSupabase,
  calculateBlankAnswers,
  type StudentDataFrontend,
  type StudentAnswerSupabase
} from "@shared/transforms";

// Configuração dos serviços Python
// Modal.com tem URLs separadas para cada endpoint
const USE_MODAL = process.env.USE_MODAL === "true";
const MODAL_OMR_HEALTH_URL = "https://xtribr--gabaritai-omr-health.modal.run";
const MODAL_OMR_PROCESS_URL = "https://xtribr--gabaritai-omr-process-image.modal.run";

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
        questoes: Array<{numero: number; resposta: string}> | Record<string, string> 
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

  const overallConfidence = answeredCount > 0 ? Math.min(0.95, 0.5 + (answeredCount / totalQuestions) * 0.45) : 0.3;

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

interface StudentFromCSV {
  nome: string;
  turma: string;
  matricula: string;
}

function parseCSV(buffer: Buffer): StudentFromCSV[] {
  const content = buffer.toString("utf-8");
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  
  if (lines.length < 2) {
    throw new Error("CSV deve ter pelo menos o cabeçalho e uma linha de dados");
  }
  
  // Detect separator (semicolon or comma)
  const headerLine = lines[0];
  const separator = headerLine.includes(";") ? ";" : ",";
  
  const headers = headerLine.split(separator).map(h => h.trim().toLowerCase().replace(/^\uFEFF/, ""));
  
  // Find column indices
  const nomeIdx = headers.findIndex(h => h.includes("nome"));
  const turmaIdx = headers.findIndex(h => h.includes("turma") || h.includes("classe") || h.includes("sala"));
  const matriculaIdx = headers.findIndex(h => h.includes("matricula") || h.includes("matrícula") || h.includes("inscricao") || h.includes("inscrição") || h.includes("id"));
  
  if (nomeIdx === -1) {
    throw new Error("Coluna 'NOME' não encontrada no CSV");
  }
  
  const students: StudentFromCSV[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = line.split(separator).map(v => v.trim());
    
    const nome = values[nomeIdx] || "";
    const turma = turmaIdx !== -1 ? values[turmaIdx] || "" : "";
    const matricula = matriculaIdx !== -1 ? values[matriculaIdx] || "" : "";
    
    if (nome) {
      students.push({ nome, turma, matricula });
    }
  }
  
  return students;
}

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
    if (usePythonOMR) {
      console.log(`[JOB ${jobId}] 🔍 Verificando Python OMR em ${PYTHON_OMR_SERVICE_URL}...`);
      const pythonOMRAvailable = await checkPythonOMRService();
      if (!pythonOMRAvailable) {
        console.warn(`[JOB ${jobId}] ⚠️  Serviço Python OMR não está disponível em ${PYTHON_OMR_SERVICE_URL}`);
        console.warn(`[JOB ${jobId}] Execute: cd python_omr_service && python app.py`);
        console.warn(`[JOB ${jobId}] Usando OMR TypeScript como fallback...`);
        usePythonOMR = false;
      } else {
        console.log(`[JOB ${jobId}] ✅ Python OMR disponível e pronto!`);
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

    // Processar páginas sequencialmente (1 por vez para estabilidade)
    const PARALLEL_PAGES = 1;
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

          try {
            // DPI 300 para melhor detecção de bolhas pelo OMR
            await execAsync(`pdftoppm -png -r 300 -singlefile "${tempPdfPath}" "${tempPngPath}"`);
          } catch {
            // Fallback: usar sharp com DPI 300
            const sharpImage = await sharp(Buffer.from(singlePagePdfBytes), { density: 300 }).png().toBuffer();
            await fs.writeFile(`${tempPngPath}.png`, sharpImage);
          }

          imageBuffer = await fs.readFile(`${tempPngPath}.png`);
          
          // Cleanup temp files
          await fs.unlink(tempPdfPath).catch(() => {});
          await fs.unlink(`${tempPngPath}.png`).catch(() => {});
        }

        // PASSO 3: Processar OMR
        console.log(`\n[JOB ${jobId}] ━━━ PASSO 3/5: OMR - PÁGINA ${pageNumber} ━━━`);
        
        let omrResult;
        let pythonHeader: { nome: string | null; turma: string | null; matricula: string | null } | undefined;

        if (usePythonOMR) {
          try {
            console.log(`[JOB ${jobId}] 🔵 Chamando Python OMR para página ${pageNumber}...`);
            const startOMR = Date.now();
            // Determinar config baseado no template
            const omrConfig = template === "modelo_menor" ? "modelo_menor" : "default";
            const pythonResult = await callPythonOMRWithRetry(imageBuffer, pageNumber, omrConfig);

            omrResult = convertPythonOMRToInternal(pythonResult, officialGabaritoTemplate.totalQuestions);
            const omrDuration = Date.now() - startOMR;

            // 🆕 Extrair header do Python OMR (Tesseract OCR)
            pythonHeader = pythonResult.pagina?.header;

            if (pythonResult.status === "sucesso" && pythonResult.pagina) {
              const detected = omrResult.detectedAnswers.filter(a => a).length;
              console.log(`[JOB ${jobId}] ✅ Python OMR (${omrConfig}): ${detected}/90 respostas detectadas (${omrDuration}ms)`);
              if (pythonHeader) {
                console.log(`[JOB ${jobId}] 📋 Header OCR: nome="${pythonHeader.nome}", turma="${pythonHeader.turma}", matricula="${pythonHeader.matricula}"`);
              }
            } else {
              throw new Error(pythonResult.mensagem || "Erro desconhecido no serviço Python OMR");
            }
          } catch (pythonError) {
            console.error(`[JOB ${jobId}] ❌ Erro no Python OMR:`, pythonError);
            throw new Error(`Serviço Python OMR falhou. Verifique se está rodando em ${PYTHON_OMR_SERVICE_URL}`);
          }
        } else {
          throw new Error(`Serviço Python OMR não disponível. Execute: cd python_omr_service && python app.py`);
        }

        // 🔥 APENAS OMR ULTRA - SEM GPT
        let mergedAnswers: Array<string | null> = [...omrResult.detectedAnswers];
        let scanQualityWarnings: string[] = [];
        
        // PASSO 4: VALIDAÇÃO DAS RESPOSTAS
        console.log(`\n[JOB ${jobId}] ━━━ PASSO 4/5: OMR ULTRA - VALIDAÇÃO (PÁGINA ${pageNumber}) ━━━`);
        
        const expectedLength = officialGabaritoTemplate.totalQuestions;
        const omrLength = omrResult.detectedAnswers.length;
        
        console.log(`[JOB ${jobId}] 📊 RESULTADO OMR ULTRA:`);
        console.log(`[JOB ${jobId}]   - Esperado: ${expectedLength} questões`);
        console.log(`[JOB ${jobId}]   - Detectadas: ${omrLength} respostas`);
        console.log(`[JOB ${jobId}]   - Respondidas: ${omrResult.detectedAnswers.filter(a => a).length}/90`);
        
        // Validar tamanho
        if (omrLength !== expectedLength) {
          const warningMsg = `OMR retornou ${omrLength} respostas, ajustando para ${expectedLength}.`;
          console.warn(`[JOB ${jobId}] ⚠️ ${warningMsg}`);
          // Preencher com nulls se faltar
          while (omrResult.detectedAnswers.length < expectedLength) {
            omrResult.detectedAnswers.push(null);
          }
          mergedAnswers = omrResult.detectedAnswers.slice(0, expectedLength);
        }
        
        // Log das primeiras 10 questões para debug
        const first10 = mergedAnswers.slice(0, 10).map((ans, idx) => `Q${idx + 1}="${ans || '-'}"`).join(", ");
        console.log(`[JOB ${jobId}] 📋 Primeiras 10: ${first10}`);
        
        console.log(`[JOB ${jobId}] ✅ OMR Ultra concluído para página ${pageNumber}`);
        console.log(`[JOB ${jobId}] 🔥 OMR: OpenCV | Header: GPT Vision`);

        // 🆕 Abordagem Híbrida: GPT Vision para header (mais preciso que Tesseract)
        let studentTurma: string | undefined;

        if (enableOcr && process.env.OPENAI_API_KEY) {
          try {
            console.log(`[JOB ${jobId}] 🤖 Extraindo header com GPT Vision...`);
            const headerResult = await extractHeaderInfoWithGPT(imageBuffer);

            if (headerResult.name) {
              studentName = headerResult.name.substring(0, 100);
              console.log(`[JOB ${jobId}] ✅ Nome (GPT): "${studentName}"`);
            }

            if (headerResult.studentNumber) {
              studentNumber = headerResult.studentNumber.substring(0, 20);
              console.log(`[JOB ${jobId}] ✅ Matrícula (GPT): "${studentNumber}"`);
            }

            if (headerResult.turma) {
              studentTurma = headerResult.turma;
              console.log(`[JOB ${jobId}] ✅ Turma (GPT): "${studentTurma}"`);
            }
          } catch (gptError) {
            console.warn(`[JOB ${jobId}] ⚠️ Erro GPT Vision header:`, gptError);
          }
        } else {
          console.log(`[JOB ${jobId}] ⚠️ OCR desativado ou OPENAI_API_KEY não configurada`);
        }

        // VALIDAÇÃO FINAL ANTES DE CRIAR finalAnswers
        if (mergedAnswers.length !== officialGabaritoTemplate.totalQuestions) {
          const errorMsg = `ERRO CRÍTICO: mergedAnswers tem tamanho incorreto (${mergedAnswers.length}) antes de criar finalAnswers. Esperado: ${officialGabaritoTemplate.totalQuestions}. Página ${pageNumber}.`;
          console.error(`[JOB ${jobId}] ❌ ${errorMsg}`);
          job.warnings.push(errorMsg);
          // Garantir tamanho correto
          while (mergedAnswers.length < officialGabaritoTemplate.totalQuestions) {
            mergedAnswers.push(null);
          }
          mergedAnswers = mergedAnswers.slice(0, officialGabaritoTemplate.totalQuestions);
        }
        
        const finalAnswers = mergedAnswers.map((ans, idx) => {
          const questionNum = idx + 1;
          // Log questões vazias nas primeiras 10 para debug
          if (ans === null && questionNum <= 10) {
            console.log(`[JOB ${jobId}] ⚠️  Q${questionNum} será salva como string vazia (era null)`);
          }
          
          // VALIDAÇÃO ESPECIAL PARA Q3: Se está vazia, verificar se OMR detectou algo
          if (questionNum === 3 && ans === null) {
            const omrQ3 = omrResult.detectedAnswers[2]; // Índice 2 = questão 3
            if (omrQ3) {
              console.warn(`[JOB ${jobId}] ⚠️  Q3 está NULL mas OMR detectou "${omrQ3}". Usando valor do OMR.`);
              return omrQ3; // Usar valor do OMR se ChatGPT retornou null
            }
          }
          
          return (ans ?? "");
        });
        
        // VALIDAÇÃO FINAL ESPECÍFICA PARA Q3
        if (finalAnswers.length > 2 && finalAnswers[2] === "") {
          const omrQ3 = omrResult.detectedAnswers[2];
          if (omrQ3) {
            console.warn(`[JOB ${jobId}] ⚠️  Q3 está vazia no finalAnswers mas OMR detectou "${omrQ3}". Corrigindo...`);
            finalAnswers[2] = omrQ3;
          }
        }
        
        // AUDITORIA FINAL: Verificar se todas as questões foram processadas
        const finalAnswered = finalAnswers.filter(a => a !== "").length;
        console.log(`[JOB ${jobId}] ✅ finalAnswers criado: ${finalAnswered}/${officialGabaritoTemplate.totalQuestions} questões respondidas (página ${pageNumber})`);
        
        // Log específico da Q3 no final
        if (finalAnswers.length > 2) {
          console.log(`[JOB ${jobId}] 🔍 Q3 FINAL: "${finalAnswers[2] || 'VAZIA'}" (página ${pageNumber})`);
        }

        // Montar texto de qualidade (sem GPT)
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
          confidence: Math.round(omrResult.overallConfidence * 100),
          rawText: qualityInfo.length > 0
            ? qualityInfo.join(" | ")
            : (omrResult.warnings.length > 0 ? omrResult.warnings.join("; ") : undefined),
        };

        // Retornar dados para o console do frontend (sem GPT)
        return { 
          student, 
          warnings: omrResult.warnings.slice(0, 5),
          pageResult: {
            detectedAnswers: mergedAnswers,
            overallConfidence: omrResult.overallConfidence,
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
  app.post("/api/process-pdf", upload.single("pdf"), async (req: Request, res: Response) => {
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
  app.post("/api/debug-omr", async (req: Request, res: Response) => {
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
  app.get("/api/process-pdf/:jobId/status", (req: Request, res: Response) => {
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
  app.get("/api/process-pdf/:jobId/results", (req: Request, res: Response) => {
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

  app.post("/api/export-excel", async (req: Request, res: Response) => {
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

  // Store for generated PDF files (in-memory for now)
  const generatedPdfs = new Map<string, { files: { name: string; data: Buffer }[]; createdAt: number }>();
  
  // Cleanup old generated PDFs (older than 30 minutes)
  setInterval(() => {
    const now = Date.now();
    Array.from(generatedPdfs.entries()).forEach(([id, entry]) => {
      if (now - entry.createdAt > 30 * 60 * 1000) {
        generatedPdfs.delete(id);
        console.log(`[GENERATE-PDF] Cleaned up old PDF batch: ${id}`);
      }
    });
  }, 5 * 60 * 1000);

  // Generate personalized PDFs from CSV
  // For large files (>50 students), generates multiple smaller PDFs with download links
  app.post("/api/generate-pdfs", uploadCsv.single("csv"), async (req: Request, res: Response) => {
    try {
      console.log("[GENERATE-PDF] Iniciando geração de PDFs personalizados...");
      const startTime = Date.now();
      
      if (!req.file) {
        return res.status(400).json({ error: "Arquivo CSV não enviado" });
      }
      
      // Parse CSV
      const students = parseCSV(req.file.buffer);
      console.log(`[GENERATE-PDF] ${students.length} alunos encontrados no CSV`);
      
      if (students.length === 0) {
        return res.status(400).json({ error: "Nenhum aluno encontrado no CSV" });
      }
      
      // Load template PDF (updated version without "RESULTADO FINAL" label)
      const templatePath = path.join(process.cwd(), "attached_assets", "template_gabarito_v2.pdf");
      let templateBytes: Buffer;
      
      try {
        templateBytes = await fs.readFile(templatePath);
      } catch (err) {
        console.error("[GENERATE-PDF] Erro ao carregar template:", err);
        return res.status(500).json({ error: "Template de gabarito não encontrado" });
      }
      
      // Load libraries once
      const { StandardFonts, rgb } = await import("pdf-lib");
      
      // Load template once and get dimensions
      const templatePdf = await PDFDocument.load(templateBytes);
      const templatePage = templatePdf.getPage(0);
      const pageWidth = templatePage.getWidth();
      const pageHeight = templatePage.getHeight();
      
      // Pre-calculate coordinates (same for all pages)
      // Nome completo: centered in the name field squares
      const nomeX = 0.025 * pageWidth + 8;
      const nomeY = pageHeight - (0.145 * pageHeight) - 20; // Middle of name squares
      // Turma e Matrícula: centered in RESULTADO FINAL box area
      const turmaX = 0.695 * pageWidth + 10;
      const turmaY = pageHeight - (0.145 * pageHeight) - 20; // Middle of RESULTADO FINAL box
      const matriculaX = 0.800 * pageWidth + 10;
      const matriculaY = pageHeight - (0.145 * pageHeight) - 20; // Same level
      
      // For large batches, limit pages per PDF to avoid memory issues
      const maxPagesPerPdf = 50;
      const totalPdfs = Math.ceil(students.length / maxPagesPerPdf);
      
      // Always save PDF to server and return download URL (works in Replit sandbox)
      console.log(`[GENERATE-PDF] Gerando ${totalPdfs} arquivo(s) PDF`);
      
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const files: { name: string; data: Buffer }[] = [];
      
      // Generate single PDF
      if (totalPdfs === 1) {
        const outputPdf = await PDFDocument.create();
        const font = await outputPdf.embedFont(StandardFonts.Helvetica);
        const fontBold = await outputPdf.embedFont(StandardFonts.HelveticaBold);
        const textColor = rgb(0, 0, 0.5);
        
        for (const student of students) {
          const [copiedPage] = await outputPdf.copyPages(templatePdf, [0]);
          outputPdf.addPage(copiedPage);
          
          copiedPage.drawText(student.nome.toUpperCase(), {
            x: nomeX, y: nomeY, size: 11, font: fontBold, color: textColor,
          });
          
          if (student.turma) {
            copiedPage.drawText(student.turma, {
              x: turmaX, y: turmaY, size: 10, font: font, color: textColor,
            });
          }
          
          if (student.matricula) {
            copiedPage.drawText(student.matricula, {
              x: matriculaX, y: matriculaY, size: 10, font: font, color: textColor,
            });
          }
        }
        
        const pdfBytes = await outputPdf.save();
        const fileName = `gabaritos_personalizados_${new Date().toISOString().split("T")[0]}.pdf`;
        files.push({ name: fileName, data: Buffer.from(pdfBytes) });
        
        // Store and return URL
        generatedPdfs.set(batchId, { files, createdAt: Date.now() });
        
        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[GENERATE-PDF] PDF gerado com ${students.length} páginas em ${elapsedTime}s`);
        
        return res.json({
          success: true,
          message: `${students.length} gabaritos gerados`,
          batchId,
          files: [{
            name: fileName,
            downloadUrl: `/api/download-pdf/${batchId}/0`,
            pages: students.length
          }],
          totalStudents: students.length,
          elapsedTime: parseFloat(elapsedTime),
        });
      }
      
      // For multiple PDFs, generate all and return links
      console.log(`[GENERATE-PDF] Gerando ${totalPdfs} arquivos PDF (máximo ${maxPagesPerPdf} páginas cada)`);
      
      for (let pdfIndex = 0; pdfIndex < totalPdfs; pdfIndex++) {
        const startIdx = pdfIndex * maxPagesPerPdf;
        const endIdx = Math.min(startIdx + maxPagesPerPdf, students.length);
        const batchStudents = students.slice(startIdx, endIdx);
        
        console.log(`[GENERATE-PDF] Gerando PDF ${pdfIndex + 1}/${totalPdfs} (alunos ${startIdx + 1}-${endIdx})`);
        
        const outputPdf = await PDFDocument.create();
        const font = await outputPdf.embedFont(StandardFonts.Helvetica);
        const fontBold = await outputPdf.embedFont(StandardFonts.HelveticaBold);
        const textColor = rgb(0, 0, 0.5);
        
        for (const student of batchStudents) {
          const [copiedPage] = await outputPdf.copyPages(templatePdf, [0]);
          outputPdf.addPage(copiedPage);
          
          copiedPage.drawText(student.nome.toUpperCase(), {
            x: nomeX, y: nomeY, size: 11, font: fontBold, color: textColor,
          });
          
          if (student.turma) {
            copiedPage.drawText(student.turma, {
              x: turmaX, y: turmaY, size: 10, font: font, color: textColor,
            });
          }
          
          if (student.matricula) {
            copiedPage.drawText(student.matricula, {
              x: matriculaX, y: matriculaY, size: 10, font: font, color: textColor,
            });
          }
        }
        
        const pdfBytes = await outputPdf.save();
        const fileName = `gabaritos_parte_${(pdfIndex + 1).toString().padStart(2, "0")}_de_${totalPdfs.toString().padStart(2, "0")}.pdf`;
        files.push({ name: fileName, data: Buffer.from(pdfBytes) });
      }
      
      // Store the files for download
      generatedPdfs.set(batchId, { files, createdAt: Date.now() });
      
      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[GENERATE-PDF] ${totalPdfs} PDFs gerados (${students.length} páginas total) em ${elapsedTime}s`);
      
      // Return JSON with download links
      res.json({
        success: true,
        message: `${students.length} gabaritos gerados em ${totalPdfs} arquivos`,
        batchId,
        files: files.map((f, idx) => ({
          name: f.name,
          downloadUrl: `/api/download-pdf/${batchId}/${idx}`,
          pages: idx === files.length - 1 
            ? students.length - (idx * maxPagesPerPdf) 
            : maxPagesPerPdf
        })),
        totalStudents: students.length,
        elapsedTime: parseFloat(elapsedTime),
      });
      
    } catch (error) {
      console.error("[GENERATE-PDF] Erro:", error);
      res.status(500).json({
        error: "Erro ao gerar PDFs",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });
  
  // Download individual PDF file
  app.get("/api/download-pdf/:batchId/:fileIndex", (req: Request, res: Response) => {
    const { batchId, fileIndex } = req.params;
    const idx = parseInt(fileIndex, 10);
    
    const batch = generatedPdfs.get(batchId);
    if (!batch) {
      return res.status(404).json({ error: "Lote não encontrado ou expirado" });
    }
    
    if (isNaN(idx) || idx < 0 || idx >= batch.files.length) {
      return res.status(404).json({ error: "Arquivo não encontrado" });
    }
    
    const file = batch.files[idx];
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`);
    res.setHeader("Content-Length", file.data.length.toString());
    res.send(file.data);
  });
  
  // Save temporary PDF for download (workaround for Replit sandbox)
  app.post("/api/save-temp-pdf", upload.single("pdf"), (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: "Arquivo não enviado" });
    }
    
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fileName = req.file.originalname || "gabaritos.pdf";
    
    generatedPdfs.set(tempId, { 
      files: [{ name: fileName, data: req.file.buffer }], 
      createdAt: Date.now() 
    });
    
    res.json({
      success: true,
      downloadUrl: `/api/download-pdf/${tempId}/0`,
    });
  });

  // Preview CSV data (for validation before generating PDFs)
  app.post("/api/preview-csv", uploadCsv.single("csv"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Arquivo CSV não enviado" });
      }
      
      const students = parseCSV(req.file.buffer);
      
      res.json({
        success: true,
        totalStudents: students.length,
        preview: students.slice(0, 10), // First 10 students for preview
        columns: {
          hasNome: true,
          hasTurma: students.some(s => s.turma),
          hasMatricula: students.some(s => s.matricula),
        },
      });
    } catch (error) {
      console.error("[PREVIEW-CSV] Erro:", error);
      res.status(400).json({
        error: "Erro ao processar CSV",
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
${top3.map((s: { name: string; tri: number; areas: Record<string, number> }, i: number) => `${i+1}. ${s.name}: ${Math.round(s.tri)} (LC:${Math.round(s.areas.LC||0)} CH:${Math.round(s.areas.CH||0)} CN:${Math.round(s.areas.CN||0)} MT:${Math.round(s.areas.MT||0)})`).join('\n')}

Precisam atenção urgente:
${bottom3.map((s: { name: string; tri: number; areas: Record<string, number> }, i: number) => `${i+1}. ${s.name}: ${Math.round(s.tri)} (LC:${Math.round(s.areas.LC||0)} CH:${Math.round(s.areas.CH||0)} CN:${Math.round(s.areas.CN||0)} MT:${Math.round(s.areas.MT||0)})`).join('\n')}

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
  app.post("/api/avaliacoes", async (req: Request, res: Response) => {
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
  app.get("/api/avaliacoes", async (req: Request, res: Response) => {
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
  app.get("/api/avaliacoes/:id", async (req: Request, res: Response) => {
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
  app.delete("/api/avaliacoes/:id", async (req: Request, res: Response) => {
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
  // PROJETOS - Sistema de Persistência
  // ============================================
  
  const PROJETOS_FILE = path.join(process.cwd(), "data", "projetos.json");

  async function ensureProjetosFile() {
    // Garantir que o diretório existe (fix: ENOENT error in production)
    const dir = path.dirname(PROJETOS_FILE);
    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.access(PROJETOS_FILE);
    } catch {
      await fs.writeFile(PROJETOS_FILE, JSON.stringify([], null, 2), "utf-8");
    }
  }

  // POST /api/projetos - Salvar novo projeto
  app.post("/api/projetos", async (req: Request, res: Response) => {
    try {
      await ensureProjetosFile();
      
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

      const content = await fs.readFile(PROJETOS_FILE, "utf-8");
      const projetos: any[] = JSON.parse(content);

      const novoProjeto = {
        id: randomUUID(),
        nome: nome.trim(),
        descricao: descricao || "",
        template,
        students: students || [],
        answerKey: answerKey || [],
        questionContents: questionContents || [],
        statistics: statistics || null,
        triScores: triScores || null,
        triScoresByArea: triScoresByArea || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        dia1Processado: dia1ProcessadoEnviado ?? template?.name === "ENEM - Dia 1",
        dia2Processado: dia2ProcessadoEnviado ?? template?.name === "ENEM - Dia 2"
      };

      projetos.push(novoProjeto);
      await fs.writeFile(PROJETOS_FILE, JSON.stringify(projetos, null, 2), "utf-8");

      console.log(`[PROJETOS] Projeto "${nome}" salvo com ${students?.length || 0} alunos`);

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
  app.get("/api/projetos", async (req: Request, res: Response) => {
    try {
      await ensureProjetosFile();
      
      const content = await fs.readFile(PROJETOS_FILE, "utf-8");
      const projetos: any[] = JSON.parse(content);

      // Retornar lista resumida (sem dados pesados)
      const lista = projetos.map(p => ({
        id: p.id,
        nome: p.nome,
        descricao: p.descricao,
        template: p.template?.name,
        totalAlunos: p.students?.length || 0,
        dia1Processado: p.dia1Processado || false,
        dia2Processado: p.dia2Processado || false,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      }));

      res.json({
        success: true,
        projetos: lista.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
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
  app.get("/api/projetos/:id", async (req: Request, res: Response) => {
    try {
      await ensureProjetosFile();
      
      const { id } = req.params;
      const content = await fs.readFile(PROJETOS_FILE, "utf-8");
      const projetos: any[] = JSON.parse(content);
      
      const projeto = projetos.find(p => p.id === id);
      if (!projeto) {
        res.status(404).json({ error: "Projeto não encontrado" });
        return;
      }

      res.json({
        success: true,
        projeto
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
  app.put("/api/projetos/:id", async (req: Request, res: Response) => {
    try {
      await ensureProjetosFile();
      
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

      const content = await fs.readFile(PROJETOS_FILE, "utf-8");
      const projetos: any[] = JSON.parse(content);
      
      const index = projetos.findIndex(p => p.id === id);
      if (index < 0) {
        res.status(404).json({ error: "Projeto não encontrado" });
        return;
      }

      const projetoExistente = projetos[index];
      
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

      // Atualizar projeto
      projetos[index] = {
        ...projetoExistente,
        nome: nome || projetoExistente.nome,
        descricao: descricao !== undefined ? descricao : projetoExistente.descricao,
        template: template || projetoExistente.template,
        students: studentsFinais,
        answerKey: answerKeyFinal,
        questionContents: questionContents || projetoExistente.questionContents,
        statistics: statistics || projetoExistente.statistics,
        triScores: triScoresFinal,
        triScoresByArea: triScoresByAreaFinal,
        updatedAt: new Date().toISOString(),
        // Acumular dias processados: manter true se já estava true OU se está sendo processado agora
        dia1Processado: dia1ProcessadoEnviado || projetoExistente.dia1Processado || template?.name === "ENEM - Dia 1",
        dia2Processado: dia2ProcessadoEnviado || projetoExistente.dia2Processado || template?.name === "ENEM - Dia 2"
      };

      await fs.writeFile(PROJETOS_FILE, JSON.stringify(projetos, null, 2), "utf-8");

      res.json({
        success: true,
        projeto: projetos[index],
        message: `Projeto "${projetos[index].nome}" atualizado com sucesso!`
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
  app.delete("/api/projetos/:id", async (req: Request, res: Response) => {
    try {
      await ensureProjetosFile();
      
      const { id } = req.params;
      const content = await fs.readFile(PROJETOS_FILE, "utf-8");
      const projetos: any[] = JSON.parse(content);
      
      const index = projetos.findIndex(p => p.id === id);
      if (index < 0) {
        res.status(404).json({ error: "Projeto não encontrado" });
        return;
      }

      const nomeRemovido = projetos[index].nome;
      projetos.splice(index, 1);
      await fs.writeFile(PROJETOS_FILE, JSON.stringify(projetos, null, 2), "utf-8");

      console.log(`[PROJETOS] Projeto "${nomeRemovido}" deletado`);

      res.json({
        success: true,
        message: `Projeto "${nomeRemovido}" deletado com sucesso!`
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

  // POST /api/admin/import-students - Importar alunos em lote
  app.post("/api/admin/import-students", async (req: Request, res: Response) => {
    try {
      const { students, schoolId } = req.body as {
        students: ImportStudentInput[];
        schoolId?: string;
      };

      if (!students || !Array.isArray(students) || students.length === 0) {
        res.status(400).json({
          error: "Lista de alunos é obrigatória",
          details: "Envie um array de objetos com matricula, nome, turma e email (opcional)"
        });
        return;
      }

      console.log(`[IMPORT] Iniciando importação de ${students.length} aluno(s)...`);

      const results: ImportStudentResult[] = [];
      let created = 0;
      let updated = 0;
      let errors = 0;

      for (const student of students) {
        const { matricula, nome, turma, email: providedEmail } = student;

        // Validação básica
        if (!matricula || !nome || !turma) {
          results.push({
            matricula: matricula || 'N/A',
            nome: nome || 'N/A',
            turma: turma || 'N/A',
            email: providedEmail || 'N/A',
            senha: '',
            status: 'error',
            message: 'Campos obrigatórios faltando (matricula, nome, turma)'
          });
          errors++;
          continue;
        }

        // Gerar email se não fornecido
        const email = providedEmail || generateEmail(matricula);
        const senha = generatePassword(matricula);

        try {
          // Verificar se já existe um profile com essa matrícula
          const { data: existingProfile } = await supabaseAdmin
            .from('profiles')
            .select('id, email')
            .eq('student_number', matricula)
            .maybeSingle();

          if (existingProfile) {
            // Atualizar profile existente
            const { error: updateError } = await supabaseAdmin
              .from('profiles')
              .update({
                name: nome,
                turma: turma,
                school_id: schoolId || null
              })
              .eq('id', existingProfile.id);

            if (updateError) {
              throw new Error(`Erro ao atualizar profile: ${updateError.message}`);
            }

            results.push({
              matricula,
              nome,
              turma,
              email: existingProfile.email,
              senha: '(senha mantida)',
              status: 'updated',
              message: 'Dados atualizados (senha não alterada)'
            });
            updated++;
            console.log(`[IMPORT] Aluno ${matricula} atualizado`);
          } else {
            // Verificar se já existe usuário com esse email
            const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
            const existingUser = existingUsers?.users?.find(u => u.email === email);

            let userId: string;

            if (existingUser) {
              // Usar usuário existente
              userId = existingUser.id;
              console.log(`[IMPORT] Usuário ${email} já existe, usando ID existente`);
            } else {
              // Criar novo usuário no Supabase Auth
              const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
                email,
                password: senha,
                email_confirm: true, // Confirmar email automaticamente
                user_metadata: {
                  name: nome,
                  role: 'student',
                  student_number: matricula,
                  turma: turma
                }
              });

              if (authError) {
                throw new Error(`Erro ao criar usuário: ${authError.message}`);
              }

              userId = authData.user.id;
              console.log(`[IMPORT] Usuário criado: ${email}`);
            }

            // Criar profile
            const { error: profileError } = await supabaseAdmin
              .from('profiles')
              .upsert({
                id: userId,
                email,
                name: nome,
                role: 'student',
                student_number: matricula,
                turma: turma,
                school_id: schoolId || null
              }, {
                onConflict: 'id'
              });

            if (profileError) {
              throw new Error(`Erro ao criar profile: ${profileError.message}`);
            }

            results.push({
              matricula,
              nome,
              turma,
              email,
              senha: existingUser ? '(usuário já existia)' : senha,
              status: 'created',
              message: existingUser ? 'Profile criado para usuário existente' : 'Aluno criado com sucesso'
            });
            created++;
            console.log(`[IMPORT] Profile criado para ${matricula}`);
          }
        } catch (error: any) {
          console.error(`[IMPORT] Erro ao processar ${matricula}:`, error.message);
          results.push({
            matricula,
            nome,
            turma,
            email,
            senha: '',
            status: 'error',
            message: error.message
          });
          errors++;
        }
      }

      console.log(`[IMPORT] Concluído: ${created} criados, ${updated} atualizados, ${errors} erros`);

      res.json({
        success: errors === 0,
        summary: {
          total: students.length,
          created,
          updated,
          errors
        },
        results
      });
    } catch (error: any) {
      console.error("[IMPORT] Erro geral:", error);
      res.status(500).json({
        error: "Erro ao importar alunos",
        details: error.message
      });
    }
  });

  // GET /api/admin/students - Listar alunos com filtros
  app.get("/api/admin/students", async (req: Request, res: Response) => {
    try {
      const { turma, search, page = '1', limit = '50' } = req.query;

      let query = supabaseAdmin
        .from('profiles')
        .select('*', { count: 'exact' })
        .eq('role', 'student')
        .order('name', { ascending: true });

      // Filtro por turma
      if (turma && typeof turma === 'string') {
        query = query.eq('turma', turma);
      }

      // Busca por nome ou matrícula
      if (search && typeof search === 'string') {
        query = query.or(`name.ilike.%${search}%,student_number.ilike.%${search}%`);
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
        .from('profiles')
        .select('turma')
        .eq('role', 'student')
        .not('turma', 'is', null);

      const turmas = [...new Set(turmasData?.map(t => t.turma).filter(Boolean))].sort();

      res.json({
        success: true,
        students: data || [],
        pagination: {
          total: count || 0,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil((count || 0) / limitNum)
        },
        turmas
      });
    } catch (error: any) {
      console.error("[STUDENTS] Erro ao listar:", error);
      res.status(500).json({
        error: "Erro ao listar alunos",
        details: error.message
      });
    }
  });

  // POST /api/admin/reset-password - Resetar senha do aluno
  app.post("/api/admin/reset-password", async (req: Request, res: Response) => {
    try {
      const { studentId, matricula } = req.body;

      if (!studentId) {
        res.status(400).json({ error: "ID do aluno é obrigatório" });
        return;
      }

      // Gerar nova senha
      const novaSenha = `${matricula || 'aluno'}${Math.floor(1000 + Math.random() * 9000)}`;

      // Atualizar senha no Supabase Auth
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        studentId,
        { password: novaSenha }
      );

      if (authError) {
        throw new Error(`Erro ao resetar senha: ${authError.message}`);
      }

      console.log(`[RESET-PWD] Senha resetada para aluno ${studentId}`);

      res.json({
        success: true,
        novaSenha,
        message: "Senha resetada com sucesso"
      });
    } catch (error: any) {
      console.error("[RESET-PWD] Erro:", error);
      res.status(500).json({
        error: "Erro ao resetar senha",
        details: error.message
      });
    }
  });

  // DELETE /api/admin/students/:id - Remover aluno
  app.delete("/api/admin/students/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Buscar dados do aluno antes de deletar
      const { data: student } = await supabaseAdmin
        .from('profiles')
        .select('name, student_number')
        .eq('id', id)
        .single();

      if (!student) {
        res.status(404).json({ error: "Aluno não encontrado" });
        return;
      }

      // Deletar profile
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('id', id);

      if (profileError) {
        throw new Error(`Erro ao deletar profile: ${profileError.message}`);
      }

      // Deletar usuário do Auth
      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(id);

      if (authError) {
        console.warn(`[DELETE] Profile deletado mas erro ao deletar auth user: ${authError.message}`);
      }

      console.log(`[DELETE] Aluno ${student.name} (${student.student_number}) removido`);

      res.json({
        success: true,
        message: `Aluno ${student.name} removido com sucesso`
      });
    } catch (error: any) {
      console.error("[DELETE] Erro:", error);
      res.status(500).json({
        error: "Erro ao remover aluno",
        details: error.message
      });
    }
  });

  // ============================================================================
  // TURMAS - Gestão e Geração de Gabaritos
  // ============================================================================

  // GET /api/admin/turmas - Listar turmas com contagem de alunos
  app.get("/api/admin/turmas", async (req: Request, res: Response) => {
    try {
      // Buscar todas as turmas distintas com contagem
      const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('turma')
        .eq('role', 'student')
        .not('turma', 'is', null);

      if (error) throw error;

      // Agrupar por turma e contar
      const turmaMap = new Map<string, number>();
      profiles?.forEach(p => {
        if (p.turma) {
          turmaMap.set(p.turma, (turmaMap.get(p.turma) || 0) + 1);
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

  // GET /api/admin/turmas/:nome/alunos - Listar alunos de uma turma
  app.get("/api/admin/turmas/:nome/alunos", async (req: Request, res: Response) => {
    try {
      const turma = decodeURIComponent(req.params.nome);

      const { data: alunos, error } = await supabaseAdmin
        .from('profiles')
        .select('id, name, student_number, turma, email')
        .eq('role', 'student')
        .eq('turma', turma)
        .order('name');

      if (error) throw error;

      res.json({
        success: true,
        turma,
        alunos: alunos || [],
        total: alunos?.length || 0
      });
    } catch (error: any) {
      console.error("[TURMAS] Erro ao listar alunos:", error);
      res.status(500).json({ error: "Erro ao listar alunos da turma", details: error.message });
    }
  });

  // POST /api/admin/generate-gabaritos - Gerar PDFs de gabaritos para turma
  app.post("/api/admin/generate-gabaritos", async (req: Request, res: Response) => {
    try {
      const { turma, alunoIds } = req.body;

      if (!turma && (!alunoIds || alunoIds.length === 0)) {
        res.status(400).json({ error: "Informe a turma ou lista de alunos" });
        return;
      }

      // Buscar alunos
      let query = supabaseAdmin
        .from('profiles')
        .select('id, name, student_number, turma')
        .eq('role', 'student')
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

      console.log(`[GABARITOS] Gerando ${alunos.length} gabaritos para turma: ${turma || 'selecionados'}`);

      // Carregar template PDF
      const templatePath = path.join(process.cwd(), "data", "Modelo-de-gabarito.pdf");
      let templateBytes: Buffer;

      try {
        templateBytes = await fs.readFile(templatePath);
      } catch {
        // Se não encontrar o template, criar um gabarito simples
        console.warn("[GABARITOS] Template não encontrado, usando gabarito padrão");

        // Criar PDF simples com pdf-lib
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont("Helvetica");
        const boldFont = await pdfDoc.embedFont("Helvetica-Bold");

        for (const aluno of alunos) {
          const page = pdfDoc.addPage([595.28, 841.89]); // A4
          const { height } = page.getSize();

          // Cabeçalho
          page.drawText("CARTÃO-RESPOSTA", {
            x: 50,
            y: height - 50,
            size: 24,
            font: boldFont,
          });

          page.drawText("SIMULADO DO EXAME NACIONAL DO ENSINO MÉDIO", {
            x: 50,
            y: height - 75,
            size: 10,
            font,
          });

          // Dados do aluno
          page.drawText(`Nome: ${aluno.name || ''}`, {
            x: 50,
            y: height - 120,
            size: 12,
            font,
          });

          page.drawText(`Turma: ${aluno.turma || ''}`, {
            x: 400,
            y: height - 120,
            size: 12,
            font,
          });

          page.drawText(`Matrícula: ${aluno.student_number || ''}`, {
            x: 400,
            y: height - 140,
            size: 12,
            font,
          });

          // Grid de respostas (simplificado)
          const startY = height - 200;
          const cols = 6;
          const questionsPerCol = 15;
          const colWidth = 85;
          const rowHeight = 20;

          for (let col = 0; col < cols; col++) {
            for (let row = 0; row < questionsPerCol; row++) {
              const qNum = col * questionsPerCol + row + 1;
              const x = 50 + col * colWidth;
              const y = startY - row * rowHeight;

              page.drawText(`${qNum.toString().padStart(2, '0')}  Ⓐ Ⓑ Ⓒ Ⓓ Ⓔ`, {
                x,
                y,
                size: 9,
                font,
              });
            }
          }
        }

        const pdfBytes = await pdfDoc.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="gabaritos_${turma || 'selecionados'}.pdf"`);
        res.send(Buffer.from(pdfBytes));
        return;
      }

      // Usar template existente
      const finalDoc = await PDFDocument.create();
      const font = await finalDoc.embedFont("Helvetica-Bold");

      for (const aluno of alunos) {
        // Carregar template para cada aluno
        const templateDoc = await PDFDocument.load(templateBytes);
        const [templatePage] = await finalDoc.copyPages(templateDoc, [0]);

        const { width, height } = templatePage.getSize();

        // Adicionar nome do aluno (posição aproximada do campo "Nome completo:")
        templatePage.drawText(aluno.name || '', {
          x: 55,
          y: height - 95, // Ajustar conforme template
          size: 11,
          font,
        });

        // Adicionar turma (campo "TURMA" no canto superior direito)
        templatePage.drawText(aluno.turma || '', {
          x: width - 180,
          y: height - 115, // Ajustar conforme template
          size: 10,
          font,
        });

        // Adicionar matrícula (campo "MATRICULA/NÚMERO")
        templatePage.drawText(aluno.student_number || '', {
          x: width - 100,
          y: height - 115, // Ajustar conforme template
          size: 10,
          font,
        });

        finalDoc.addPage(templatePage);
      }

      const pdfBytes = await finalDoc.save();

      console.log(`[GABARITOS] PDF gerado com ${alunos.length} páginas`);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="gabaritos_${turma || 'selecionados'}.pdf"`);
      res.send(Buffer.from(pdfBytes));

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

      const { data, error } = await supabaseAdmin
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

      // 1. Buscar dados do aluno para este exam
      const { data: studentResult, error: studentError } = await supabaseAdmin
        .from("student_answers")
        .select("*")
        .eq("student_id", studentId)
        .eq("exam_id", examId)
        .single();

      if (studentError || !studentResult) {
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
      const answerKey = exam.answer_key || [];
      const questionContents = exam.question_contents || [];

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
        turmaSize: totalStudents
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

  // ===========================================================================
  // ESCOLA ENDPOINTS - Para school_admin (coordenadores)
  // ===========================================================================

  // GET /api/escola/results - Buscar resultados dos alunos da escola
  app.get("/api/escola/results", async (req: Request, res: Response) => {
    try {
      // Por enquanto, retorna todos os resultados (após implementar auth, filtrar por school_id)
      // Em produção: extrair school_id do token JWT e filtrar

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

      // Formatar resultados
      const results = (answers || []).map((a: any) => ({
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
        if (r.score != null) {
          totalScore += r.score;
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

  return httpServer;
}
