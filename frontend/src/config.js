// Configuração global da aplicação - EMERGENCY FIX

// HARD-CODED URL FOR PRODUCTION - EMERGENCY FIX
export const API_URL = 'https://theraconnect-prd.onrender.com/api';
export const FRONTEND_URL = 'https://terapia-conect-frontend.vercel.app';

// Forçando ambiente de produção para resolver problema urgente
const isDevelopment = false;

// URL hardcoded para resolver problema urgente
export const BASE_API_URL = 'https://theraconnect-prd.onrender.com/api';

// Debug global para mostrar qual URL está sendo usada
console.log('CONFIG.JS - URL da API configurada:', BASE_API_URL);

// Injetar URL global na janela para debug
if (typeof window !== 'undefined') {
  window.__API_CONFIG = {
    url: BASE_API_URL,
    timestamp: new Date().toISOString()
  };
}

// Exportar configuração para uso em toda a aplicação
export default {
  apiUrl: BASE_API_URL,
  frontendUrl: FRONTEND_URL,
  isDevelopment
};