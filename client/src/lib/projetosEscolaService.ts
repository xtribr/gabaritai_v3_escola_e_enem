/**
 * Service para gerenciar projetos de escola via API do Supabase
 * Substitui o localStorage por armazenamento persistente
 */

import { authGet, authPost, authPut, authDelete } from './authFetch';
import type { ProjetoEscola, ProvaCorrigida } from '@shared/schema';

// Interface para o formato retornado pela API (snake_case)
interface ProjetoEscolaAPI {
  id: string;
  school_id: string;
  created_by: string | null;
  nome: string;
  turma: string | null;
  descricao: string | null;
  provas: ProvaCorrigida[];
  alunos_unicos: Array<{ id: string; nome: string; turma?: string }>;
  created_at: string;
  updated_at: string;
}

interface APIResponse<T> {
  success: boolean;
  projeto?: T;
  projetos?: T[];
  error?: string;
  message?: string;
}

/**
 * Lista todos os projetos da escola do usuário
 */
export async function listarProjetosEscola(schoolId?: string): Promise<ProjetoEscola[]> {
  try {
    const url = schoolId
      ? `/api/projetos-escola?school_id=${schoolId}`
      : '/api/projetos-escola';

    const response = await authGet<APIResponse<ProjetoEscolaAPI>>(url);

    if (response.success && response.projetos) {
      // Converter do formato API para o formato frontend
      return response.projetos.map(p => ({
        id: p.id!,
        nome: p.nome,
        turma: p.turma || '',
        descricao: p.descricao || '',
        provas: p.provas || [],
        alunosUnicos: p.alunos_unicos || [],
        createdAt: p.created_at || new Date().toISOString(),
        updatedAt: p.updated_at || new Date().toISOString(),
      }));
    }

    return [];
  } catch (error) {
    console.error('[ProjetosEscolaService] Erro ao listar:', error);
    return [];
  }
}

/**
 * Cria um novo projeto de escola
 */
export async function criarProjetoEscola(
  projeto: Omit<ProjetoEscola, 'id' | 'createdAt' | 'updatedAt'>,
  schoolId?: string
): Promise<ProjetoEscola | null> {
  try {
    const response = await authPost<APIResponse<ProjetoEscolaAPI>>('/api/projetos-escola', {
      nome: projeto.nome,
      turma: projeto.turma || null,
      descricao: projeto.descricao || null,
      provas: projeto.provas || [],
      alunos_unicos: projeto.alunosUnicos || [],
      school_id: schoolId,
    });

    if (response.success && response.projeto) {
      const p = response.projeto;
      return {
        id: p.id!,
        nome: p.nome,
        turma: p.turma || '',
        descricao: p.descricao || '',
        provas: p.provas || [],
        alunosUnicos: p.alunos_unicos || [],
        createdAt: p.created_at || new Date().toISOString(),
        updatedAt: p.updated_at || new Date().toISOString(),
      };
    }

    return null;
  } catch (error) {
    console.error('[ProjetosEscolaService] Erro ao criar:', error);
    throw error;
  }
}

/**
 * Busca um projeto específico pelo ID
 */
export async function buscarProjetoEscola(id: string): Promise<ProjetoEscola | null> {
  try {
    const response = await authGet<APIResponse<ProjetoEscolaAPI>>(`/api/projetos-escola/${id}`);

    if (response.success && response.projeto) {
      const p = response.projeto;
      return {
        id: p.id!,
        nome: p.nome,
        turma: p.turma || '',
        descricao: p.descricao || '',
        provas: p.provas || [],
        alunosUnicos: p.alunos_unicos || [],
        createdAt: p.created_at || new Date().toISOString(),
        updatedAt: p.updated_at || new Date().toISOString(),
      };
    }

    return null;
  } catch (error) {
    console.error('[ProjetosEscolaService] Erro ao buscar:', error);
    return null;
  }
}

/**
 * Atualiza um projeto existente
 */
export async function atualizarProjetoEscola(
  id: string,
  dados: Partial<ProjetoEscola>
): Promise<ProjetoEscola | null> {
  try {
    const updateData: Record<string, unknown> = {};

    if (dados.nome !== undefined) updateData.nome = dados.nome;
    if (dados.turma !== undefined) updateData.turma = dados.turma || null;
    if (dados.descricao !== undefined) updateData.descricao = dados.descricao || null;
    if (dados.provas !== undefined) updateData.provas = dados.provas;
    if (dados.alunosUnicos !== undefined) updateData.alunos_unicos = dados.alunosUnicos;

    const response = await authPut<APIResponse<ProjetoEscolaAPI>>(`/api/projetos-escola/${id}`, updateData);

    if (response.success && response.projeto) {
      const p = response.projeto;
      return {
        id: p.id!,
        nome: p.nome,
        turma: p.turma || '',
        descricao: p.descricao || '',
        provas: p.provas || [],
        alunosUnicos: p.alunos_unicos || [],
        createdAt: p.created_at || new Date().toISOString(),
        updatedAt: p.updated_at || new Date().toISOString(),
      };
    }

    return null;
  } catch (error) {
    console.error('[ProjetosEscolaService] Erro ao atualizar:', error);
    throw error;
  }
}

/**
 * Deleta um projeto
 */
export async function deletarProjetoEscola(id: string): Promise<boolean> {
  try {
    const response = await authDelete<APIResponse<never>>(`/api/projetos-escola/${id}`);
    return response.success === true;
  } catch (error) {
    console.error('[ProjetosEscolaService] Erro ao deletar:', error);
    throw error;
  }
}

/**
 * Salva ou atualiza um projeto (upsert)
 * Se o projeto tem ID, atualiza. Se não tem, cria.
 */
export async function salvarProjetoEscola(
  projeto: ProjetoEscola,
  schoolId?: string
): Promise<ProjetoEscola | null> {
  if (projeto.id && !projeto.id.startsWith('temp-')) {
    // Projeto existente - atualizar
    return atualizarProjetoEscola(projeto.id, projeto);
  } else {
    // Projeto novo - criar
    return criarProjetoEscola(projeto, schoolId);
  }
}

/**
 * Migra projetos do localStorage para o Supabase
 * Usado na transição da versão antiga para a nova
 */
export async function migrarDoLocalStorage(schoolId: string): Promise<number> {
  try {
    const projetosSalvos = localStorage.getItem('projetosEscola');
    if (!projetosSalvos) return 0;

    const projetos: ProjetoEscola[] = JSON.parse(projetosSalvos);
    let migrados = 0;

    for (const projeto of projetos) {
      try {
        // Verificar se já existe no Supabase (pelo nome e turma)
        const existentes = await listarProjetosEscola(schoolId);
        const jaExiste = existentes.some(
          p => p.nome === projeto.nome && p.turma === projeto.turma
        );

        if (!jaExiste) {
          await criarProjetoEscola({
            nome: projeto.nome,
            turma: projeto.turma,
            descricao: projeto.descricao,
            provas: projeto.provas,
            alunosUnicos: projeto.alunosUnicos,
          }, schoolId);
          migrados++;
          console.log(`[Migração] Projeto "${projeto.nome}" migrado para Supabase`);
        }
      } catch (err) {
        console.error(`[Migração] Erro ao migrar projeto "${projeto.nome}":`, err);
      }
    }

    // Após migração bem-sucedida, limpar localStorage
    if (migrados > 0) {
      // Manter backup temporário
      localStorage.setItem('projetosEscola_backup', projetosSalvos);
      // Limpar original
      localStorage.removeItem('projetosEscola');
      console.log(`[Migração] ${migrados} projetos migrados. Backup mantido em projetosEscola_backup`);
    }

    return migrados;
  } catch (error) {
    console.error('[Migração] Erro durante migração:', error);
    return 0;
  }
}
