/**
 * Middleware de autenticação flexível
 * 
 * Este middleware permite diferentes tipos de autenticação, incluindo:
 * 1. Token JWT (padrão)
 * 2. API Key
 * 3. Session Token
 * 4. Bypass para rotas de teste ou desenvolvimento
 */

const { createLogger } = require('../utils/logger');
const logger = createLogger('flex-auth');

/**
 * Lista de rotas que podem ser acessadas sem autenticação em ambiente de desenvolvimento
 */
const BYPASS_ROUTES = [
  '/api/webrtc/session',
  '/api/webrtc/record/start',
  '/api/webrtc/record/stop',
  '/api/webrtc/record/transcribe',
  '/api/webrtc/sessions'
];

/**
 * Middleware de autenticação flexível
 * @param {Object} req - Requisição Express
 * @param {Object} res - Resposta Express
 * @param {Function} next - Função de callback
 */
const flexAuthMiddleware = (req, res, next) => {
  // Se o usuário já foi autenticado por outro middleware, continuar
  if (req.user) {
    return next();
  }
  
  // Verificar se a rota está na lista de bypass para ambiente de desenvolvimento
  if (process.env.NODE_ENV !== 'production') {
    const currentPath = req.path;
    const shouldBypass = BYPASS_ROUTES.some(route => currentPath.includes(route));
    
    if (shouldBypass) {
      logger.info(`Bypass de autenticação flexível para rota: ${currentPath}`);
      // Definir um usuário fictício para ambiente de desenvolvimento
      req.user = { 
        id: 'dev-user', 
        name: 'Development User', 
        role: 'ADMIN',
        isDevUser: true
      };
      return next();
    }
  }
  
  // Verificar API Key (se disponível)
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === process.env.API_KEY) {
    logger.info('Autenticação via API Key');
    req.user = { 
      id: 'api-user', 
      name: 'API User', 
      role: 'SYSTEM',
      isApiUser: true
    };
    return next();
  }
  
  // Verificar Session Token (se disponível)
  const sessionToken = req.headers['x-session-token'] || req.cookies?.sessionToken;
  if (sessionToken && process.env.SESSION_TOKENS?.includes(sessionToken)) {
    logger.info('Autenticação via Session Token');
    req.user = { 
      id: 'session-user', 
      name: 'Session User', 
      role: 'CLIENT',
      isSessionUser: true
    };
    return next();
  }
  
  // Se chegou até aqui e ainda não foi autenticado
  logger.info('Nenhum método de autenticação flexível disponível');
  return next();
};

module.exports = flexAuthMiddleware; 