import axios from 'axios';
import { BASE_API_URL } from '../config';

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
    const fullUrl = `${config.baseURL}${config.url}`;
    const method = config.method ? config.method.toUpperCase() : 'GET';
    console.log(`🚀 REQUISIÇÃO ENVIADA: ${method} ${fullUrl}`);
    
    // Verificar e corrigir duplo /api/ no URL
    if (config.url.startsWith('/api/') && config.baseURL.endsWith('/api')) {
      // Remove o /api/ duplicado no início da URL
      config.url = config.url.substring(4);
      console.log(`⚠️ URL corrigida para evitar duplicação: ${config.baseURL}${config.url}`);
    }
    
    // Log dos dados enviados
    if (config.data) {
      console.log(`📝 Dados:`, config.data);
    }
    
    // Log dos parâmetros de consulta
    if (config.params) {
      console.log(`🔍 Parâmetros:`, config.params);
    }
    
    // Verificar e adicionar token
    const token = localStorage.getItem('token');
    const hasToken = !!token;
    console.log(`🔑 Token presente: ${hasToken ? 'Sim' : 'Não'}`);
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      console.log(`✅ Token adicionado ao cabeçalho de autorização`);
    }
    
    // Log dos headers
    console.log(`📋 Headers:`, config.headers);
    
    return config;
  },
  (error) => {
    console.error(`❌ ERRO NA REQUISIÇÃO:`, error);
    return Promise.reject(error);
  }
);

// Interceptor para tratamento de erros nas respostas
api.interceptors.response.use(
  (response) => {
    const { config, status, data } = response;
    const method = config.method ? config.method.toUpperCase() : 'GET';
    const url = `${config.baseURL}${config.url}`;
    
    console.log(`✅ RESPOSTA RECEBIDA: ${status} ${method} ${url}`);
    console.log(`📊 Dados recebidos:`, data);
    
    return response;
  },
  async (error) => {
    // Extrair informações do erro
    const { response, config } = error;
    const status = response?.status || 'FALHA DE REDE';
    const url = config ? `${config.baseURL || ''}${config.url || ''}` : 'URL desconhecida';
    const method = config?.method ? config.method.toUpperCase() : 'MÉTODO DESCONHECIDO';
    
    console.error(`❌ ERRO ${status}: ${method} ${url}`);
    
    if (response?.data) {
      console.error(`📄 Detalhes do erro:`, response.data);
    }
    
    // Verificar se o erro é de autenticação (401)
    if (response && status === 401) {
      console.warn(`🔒 Erro de autenticação (401) - Token inválido ou expirado`);
      
      // Remover token inválido
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      console.log(`🗑️ Token e dados do usuário removidos do localStorage`);
      
      // Verificar se estamos em uma rota administrativa
      const isAdminRoute = window.location.pathname.startsWith('/admin');
      const redirectUrl = isAdminRoute ? '/admin/login' : '/login';
      
      console.log(`🔄 Redirecionando para ${redirectUrl}`);
      
      // Redirecionar para a página de login apropriada
      if (isAdminRoute) {
        window.location.href = '/admin/login';
      } else {
        window.location.href = '/login';
      }
    }
    
    // Verificar se é erro 404 ou 500 (para API específicas que não são críticas)
    if (response && (status === 404 || status === 500)) {
      // Verificar se a URL da API está em uma lista de bypass (APIs opcionais)
      const bypassAPIs = ['/api/suggestions', '/api/analyze', '/api/report'];
      const requestUrl = config.url;
      
      if (bypassAPIs.some(api => requestUrl.includes(api))) {
        console.log(`⚠️ Erro ${status} com bypass: ${requestUrl}`);
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