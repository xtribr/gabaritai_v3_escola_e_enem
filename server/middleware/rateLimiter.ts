import rateLimit from 'express-rate-limit';

/**
 * Rate limiter para endpoints de autenticação (login)
 * Mais restritivo para prevenir ataques de força bruta
 * 5 tentativas por minuto por IP
 */
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 5, // máximo 5 tentativas
  message: {
    error: 'Muitas tentativas de login. Aguarde 1 minuto antes de tentar novamente.',
    retryAfterMs: 60000,
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Usa IP padrão (sem keyGenerator customizado para evitar problemas IPv6)
});

/**
 * Rate limiter para mudança de senha
 * 3 tentativas por minuto por IP
 */
export const passwordRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 3, // máximo 3 tentativas
  message: {
    error: 'Muitas tentativas de alteração de senha. Aguarde 1 minuto.',
    retryAfterMs: 60000,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter para API geral
 * 100 requisições por minuto por IP
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 100, // máximo 100 requisições
  message: {
    error: 'Limite de requisições excedido. Aguarde um momento.',
    retryAfterMs: 60000,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter para registro de novos usuários
 * 3 tentativas por hora por IP (muito restritivo)
 */
export const registerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3, // máximo 3 registros
  message: {
    error: 'Muitas tentativas de registro. Aguarde 1 hora.',
    retryAfterMs: 3600000,
  },
  standardHeaders: true,
  legacyHeaders: false,
});
