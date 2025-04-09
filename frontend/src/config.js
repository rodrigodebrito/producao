// Configuração global da aplicação

// Determinar o ambiente atual
const isDevelopment = 
  window.location.hostname === 'localhost' || 
  window.location.hostname === '127.0.0.1';

// URLs baseadas no ambiente
export const API_URL = isDevelopment 
  ? 'http://localhost:3000/api'
  : 'https://theraconnect-prd.onrender.com/api';

export const FRONTEND_URL = isDevelopment
  ? 'http://localhost:3001'
  : 'https://terapia-conect-frontend.vercel.app';

// URL base da API para facilitar importação
export const BASE_API_URL = API_URL;

// Debug global para mostrar qual URL está sendo usada
console.log(`CONFIG.JS - URL da API configurada: ${BASE_API_URL} (${isDevelopment ? 'desenvolvimento' : 'produção'})`);

// Injetar URL global na janela para debug
if (typeof window !== 'undefined') {
  window.__API_CONFIG = {
    url: BASE_API_URL,
    environment: isDevelopment ? 'development' : 'production',
    timestamp: new Date().toISOString()
  };
}

// Exportar configuração para uso em toda a aplicação
export default {
  apiUrl: BASE_API_URL,
  frontendUrl: FRONTEND_URL,
  isDevelopment
};