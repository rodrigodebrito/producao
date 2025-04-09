import axios from 'axios';
import { BASE_API_URL, isDevelopment } from '../config';

// Usar a URL da configuração que detecta automaticamente o ambiente
const baseURL = BASE_API_URL;

// Criar uma instância do axios com configuração básica
console.log('API.JS - Criando instância do axios com baseURL:', baseURL);

// Injetar no window para debug
if (typeof window !== 'undefined') {
  window.__API_AXIOS_CONFIG = {
    baseURL,
    timestamp: new Date().toISOString()
  };
}

// Criar uma instância do axios com configuração básica
const api = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor para adicionar token de autorização em todas requisições
api.interceptors.request.use(
  (config) => {
    // Armazenar a URL original para debug
    const originalUrl = `${config.baseURL}${config.url}`;
    
    // Corrigir casos de duplicação de '/api'
    if (config.url.startsWith('/api/') && config.baseURL.endsWith('/api')) {
      // Remove o /api/ duplicado no início da URL
      config.url = config.url.substring(4);
      console.log(`API.JS - Corrigindo URL duplicada: ${originalUrl} -> ${config.baseURL}${config.url}`);
    }
    
    // Corrigir casos onde a URL absoluta tem '/api/api/'
    if (config.baseURL.includes('/api') && config.url.includes('/api/')) {
      const apiPattern = /\/api\//g;
      let matchCount = (config.url.match(apiPattern) || []).length;
      
      if (matchCount > 1) {
        // Remover ocorrências extras de /api/
        config.url = config.url.replace(/\/api\/api\//g, '/api/');
        console.log(`API.JS - Removendo múltiplos '/api/' da URL: ${originalUrl} -> ${config.baseURL}${config.url}`);
      }
    }
    
    // Verificar se a URL usa 'http://localhost' explicitamente em produção
    if (!isDevelopment && config.url.includes('localhost')) {
      // Substituir referências a localhost pelo URL de produção
      config.url = config.url.replace(/https?:\/\/localhost:3000/g, 'https://theraconnect-prd.onrender.com');
      console.log(`API.JS - Substituindo localhost em ambiente de produção: ${config.baseURL}${config.url}`);
    }
    
    // Log da URL final
    console.log(`Enviando requisição para: ${config.baseURL}${config.url}`);
    
    // Adicionar token de autenticação
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor para tratamento de erros nas respostas
api.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    // Verificar se o erro é de autenticação (401)
    if (error.response && error.response.status === 401) {
      // Remover token inválido
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      
      // Verificar se estamos em uma rota administrativa
      const isAdminRoute = window.location.pathname.startsWith('/admin');
      
      // Redirecionar para a página de login apropriada
      if (isAdminRoute) {
        window.location.href = '/admin/login';
      } else {
        window.location.href = '/login';
      }
    }
    
    // Verificar se é erro 404 ou 500 (para API específicas que não são críticas)
    if (error.response && (error.response.status === 404 || error.response.status === 500)) {
      // Verificar se a URL da API está em uma lista de bypass (APIs opcionais)
      const bypassAPIs = ['/api/suggestions', '/api/analyze', '/api/report'];
      const requestUrl = error.config.url;
      
      if (bypassAPIs.some(api => requestUrl.includes(api))) {
        console.log(`Erro 404/500, verificando se é uma API que tem bypass: ${requestUrl}`);
        // Retornar um erro amigável que pode ser tratado pelo cliente
        return Promise.resolve({
          data: {
            error: 'service_unavailable',
            message: 'Serviço temporariamente indisponível'
          }
        });
      }
    }
    
    return Promise.reject(error);
  }
);

export default api; 