// Configuração global da aplicação

export const API_URL = 'https://theraconnect-prd.onrender.com/api';
export const FRONTEND_URL = 'https://terapia-conect-frontend.vercel.app';

// Verificar se estamos em ambiente de desenvolvimento
const isDevelopment = window.location.hostname === 'localhost' || 
                      window.location.hostname === '127.0.0.1';

// Usar localhost para desenvolvimento
export const BASE_API_URL = isDevelopment 
  ? 'http://localhost:3000/api' 
  : API_URL;

// Exportar configuração para uso em toda a aplicação
export default {
  apiUrl: BASE_API_URL,
  frontendUrl: FRONTEND_URL,
  isDevelopment
}; 