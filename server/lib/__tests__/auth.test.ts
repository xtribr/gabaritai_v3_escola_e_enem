import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole, requireSchoolAccess, type AuthenticatedRequest } from '../auth';

// Mock supabaseAdmin
vi.mock('../supabase', () => ({
  supabaseAdmin: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
    })),
  },
}));

import { supabaseAdmin } from '../supabase';

// Helper functions
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    body: {},
    params: {},
    query: {},
    ...overrides,
  } as Request;
}

function createMockResponse(): Response & { _status?: number; _json?: unknown } {
  const res: Partial<Response> & { _status?: number; _json?: unknown } = {
    status: vi.fn(function(this: typeof res, code: number) {
      this._status = code;
      return this as Response;
    }),
    json: vi.fn(function(this: typeof res, data: unknown) {
      this._json = data;
      return this as Response;
    }),
  };
  return res as Response & { _status?: number; _json?: unknown };
}

describe('Auth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requireAuth', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res._json).toEqual({
        error: 'Token de autenticação ausente',
        code: 'MISSING_TOKEN',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when Authorization header is not Bearer', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Basic abc123' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res._json).toEqual({
        error: 'Token de autenticação ausente',
        code: 'MISSING_TOKEN',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when token is invalid', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer invalid-token' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid token', name: 'AuthError', status: 401 },
      } as any);

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res._json).toEqual({
        error: 'Token inválido ou expirado',
        code: 'INVALID_TOKEN',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next and sets user when token is valid', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer valid-token' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValue({
        data: {
          user: { id: 'user-123', email: 'test@example.com' },
        },
        error: null,
      } as any);

      await requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect((req as AuthenticatedRequest).user).toEqual({
        id: 'user-123',
        email: 'test@example.com',
      });
    });

    it('sets empty email when user has no email', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer valid-token' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValue({
        data: {
          user: { id: 'user-123', email: null },
        },
        error: null,
      } as any);

      await requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect((req as AuthenticatedRequest).user?.email).toBe('');
    });
  });

  describe('requireRole', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns 401 when user is not set', async () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requireRole('super_admin');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res._json).toEqual({
        error: 'Usuário não autenticado',
        code: 'NOT_AUTHENTICATED',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when profile not found', async () => {
      const req = createMockRequest() as AuthenticatedRequest;
      req.user = { id: 'user-123', email: 'test@example.com' };
      const res = createMockResponse();
      const next = vi.fn();

      vi.mocked(supabaseAdmin.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      } as any);

      const middleware = requireRole('super_admin');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res._json).toEqual({
        error: 'Perfil de usuário não encontrado',
        code: 'PROFILE_NOT_FOUND',
      });
    });

    it('returns 403 when role is not allowed', async () => {
      const req = createMockRequest() as AuthenticatedRequest;
      req.user = { id: 'user-123', email: 'test@example.com' };
      const res = createMockResponse();
      const next = vi.fn();

      vi.mocked(supabaseAdmin.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'user-123', role: 'student', school_id: 'school-1', name: 'Test', allowed_series: null },
              error: null,
            }),
          }),
        }),
      } as any);

      const middleware = requireRole('super_admin', 'school_admin');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res._json).toEqual({
        error: 'Permissão insuficiente',
        code: 'INSUFFICIENT_PERMISSION',
        requiredRoles: ['super_admin', 'school_admin'],
        currentRole: 'student',
      });
    });

    it('calls next when role is allowed (single role)', async () => {
      const req = createMockRequest() as AuthenticatedRequest;
      req.user = { id: 'user-123', email: 'test@example.com' };
      const res = createMockResponse();
      const next = vi.fn();

      const mockProfile = {
        id: 'user-123',
        role: 'super_admin',
        school_id: null,
        name: 'Admin',
        allowed_series: null,
      };

      vi.mocked(supabaseAdmin.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: mockProfile,
              error: null,
            }),
          }),
        }),
      } as any);

      const middleware = requireRole('super_admin');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.profile).toEqual(mockProfile);
    });

    it('calls next when role is in allowed list (multiple roles)', async () => {
      const req = createMockRequest() as AuthenticatedRequest;
      req.user = { id: 'user-123', email: 'test@example.com' };
      const res = createMockResponse();
      const next = vi.fn();

      const mockProfile = {
        id: 'user-123',
        role: 'school_admin',
        school_id: 'school-1',
        name: 'School Admin',
        allowed_series: ['3A', '3B'],
      };

      vi.mocked(supabaseAdmin.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: mockProfile,
              error: null,
            }),
          }),
        }),
      } as any);

      const middleware = requireRole('super_admin', 'school_admin');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.profile).toEqual(mockProfile);
    });
  });

  describe('requireSchoolAccess', () => {
    it('returns 401 when profile is not loaded', async () => {
      const req = createMockRequest() as AuthenticatedRequest;
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requireSchoolAccess();
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res._json).toEqual({
        error: 'Perfil não carregado',
        code: 'PROFILE_NOT_LOADED',
      });
    });

    it('allows super_admin to access any school', async () => {
      const req = createMockRequest({
        body: { school_id: 'other-school' },
      }) as AuthenticatedRequest;
      req.profile = {
        id: 'user-123',
        role: 'super_admin',
        school_id: null,
        name: 'Admin',
        allowed_series: null,
      };
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requireSchoolAccess();
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('denies school_admin access to different school (via body)', async () => {
      const req = createMockRequest({
        body: { school_id: 'other-school' },
      }) as AuthenticatedRequest;
      req.profile = {
        id: 'user-123',
        role: 'school_admin',
        school_id: 'my-school',
        name: 'Admin',
        allowed_series: null,
      };
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requireSchoolAccess();
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res._json).toEqual({
        error: 'Acesso negado a esta escola',
        code: 'SCHOOL_ACCESS_DENIED',
      });
    });

    it('denies school_admin access to different school (via params)', async () => {
      const req = createMockRequest({
        params: { school_id: 'other-school' },
      }) as AuthenticatedRequest;
      req.profile = {
        id: 'user-123',
        role: 'school_admin',
        school_id: 'my-school',
        name: 'Admin',
        allowed_series: null,
      };
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requireSchoolAccess();
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('allows school_admin access to own school', async () => {
      const req = createMockRequest({
        body: { school_id: 'my-school' },
      }) as AuthenticatedRequest;
      req.profile = {
        id: 'user-123',
        role: 'school_admin',
        school_id: 'my-school',
        name: 'Admin',
        allowed_series: null,
      };
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requireSchoolAccess();
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('allows access when no school_id is specified', async () => {
      const req = createMockRequest() as AuthenticatedRequest;
      req.profile = {
        id: 'user-123',
        role: 'school_admin',
        school_id: 'my-school',
        name: 'Admin',
        allowed_series: null,
      };
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requireSchoolAccess();
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('uses custom schoolIdParam when specified', async () => {
      const req = createMockRequest({
        body: { customSchoolId: 'other-school' },
      }) as AuthenticatedRequest;
      req.profile = {
        id: 'user-123',
        role: 'school_admin',
        school_id: 'my-school',
        name: 'Admin',
        allowed_series: null,
      };
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requireSchoolAccess('customSchoolId');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
