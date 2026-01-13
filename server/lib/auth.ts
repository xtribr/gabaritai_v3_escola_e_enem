import type { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from './supabase';

// Tipos para request autenticado
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
  profile?: {
    id: string;
    role: string;
    school_id: string | null;
    name: string;
    allowed_series: string[] | null;
  };
}

/**
 * Middleware de autenticação
 * Verifica se o token JWT é válido e adiciona o usuário ao request
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Token de autenticação ausente',
        code: 'MISSING_TOKEN'
      });
      return;
    }

    const token = authHeader.slice(7);
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
      console.log('[AUTH] Token inválido:', error?.message);
      res.status(401).json({
        error: 'Token inválido ou expirado',
        code: 'INVALID_TOKEN'
      });
      return;
    }

    (req as AuthenticatedRequest).user = {
      id: data.user.id,
      email: data.user.email || ''
    };

    next();
  } catch (err) {
    console.error('[AUTH] Erro na verificação:', err);
    res.status(500).json({
      error: 'Erro na verificação de autenticação',
      code: 'AUTH_ERROR'
    });
  }
}

/**
 * Middleware de autorização por role
 * Verifica se o usuário tem uma das roles permitidas
 */
export function requireRole(...allowedRoles: string[]) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.user?.id;

      if (!userId) {
        res.status(401).json({
          error: 'Usuário não autenticado',
          code: 'NOT_AUTHENTICATED'
        });
        return;
      }

      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('id, role, school_id, name, allowed_series')
        .eq('id', userId)
        .single();

      if (error || !profile) {
        console.log('[AUTH] Perfil não encontrado:', userId);
        res.status(403).json({
          error: 'Perfil de usuário não encontrado',
          code: 'PROFILE_NOT_FOUND'
        });
        return;
      }

      if (!allowedRoles.includes(profile.role)) {
        console.log('[AUTH] Role não autorizada:', profile.role, 'esperado:', allowedRoles);
        res.status(403).json({
          error: 'Permissão insuficiente',
          code: 'INSUFFICIENT_PERMISSION',
          requiredRoles: allowedRoles,
          currentRole: profile.role
        });
        return;
      }

      authReq.profile = profile;
      next();
    } catch (err) {
      console.error('[AUTH] Erro na verificação de role:', err);
      res.status(500).json({
        error: 'Erro na verificação de permissões',
        code: 'ROLE_CHECK_ERROR'
      });
    }
  };
}

/**
 * Middleware para verificar acesso à escola
 * Garante que o usuário só acessa dados da própria escola
 */
export function requireSchoolAccess(schoolIdParam: string = 'schoolId') {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const profile = authReq.profile;

      if (!profile) {
        res.status(401).json({
          error: 'Perfil não carregado',
          code: 'PROFILE_NOT_LOADED'
        });
        return;
      }

      // Super admin tem acesso a todas as escolas
      if (profile.role === 'super_admin') {
        next();
        return;
      }

      // Pegar school_id do body, params ou query
      const targetSchoolId =
        req.body?.[schoolIdParam] ||
        req.body?.school_id ||
        req.params?.[schoolIdParam] ||
        req.params?.school_id ||
        req.query?.[schoolIdParam] ||
        req.query?.school_id;

      // Se não tem school_id especificado, usar o do perfil
      if (!targetSchoolId) {
        next();
        return;
      }

      // Verificar se é a mesma escola
      if (profile.school_id !== targetSchoolId) {
        console.log('[AUTH] Acesso negado - escola diferente:', {
          userSchool: profile.school_id,
          targetSchool: targetSchoolId
        });
        res.status(403).json({
          error: 'Acesso negado a esta escola',
          code: 'SCHOOL_ACCESS_DENIED'
        });
        return;
      }

      next();
    } catch (err) {
      console.error('[AUTH] Erro na verificação de escola:', err);
      res.status(500).json({
        error: 'Erro na verificação de acesso à escola',
        code: 'SCHOOL_CHECK_ERROR'
      });
    }
  };
}
