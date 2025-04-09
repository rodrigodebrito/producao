import api from './api';

const authService = {
  /**
   * Login de usuário (cliente, terapeuta ou administrador)
   */
  login: async (email, password) => {
    try {
      console.log(`authService: Tentando login com ${email}`);
      console.log('authService: URL base usada:', api.defaults.baseURL);
      
      // Rota correta: o backend define a rota como /api/auth (não /api/auth/login)
      console.log('authService: Enviando requisição para:', api.defaults.baseURL + '/auth');
      
      const response = await api.post('/auth', { email, password });
      
      console.log('authService: Resposta do login:', response.data);
      
      if (response.data && response.data.token) {
        // Salvar token no localStorage
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.user));
        console.log('authService: Token e dados do usuário salvos com sucesso');
      } else {
        console.warn('authService: Resposta não contém token ou dados do usuário:', response.data);
      }
      
      return response.data;
    } catch (error) {
      console.error('Erro de login:', error);
      if (error.response) {
        console.error('authService: Detalhes do erro:', {
          status: error.response.status,
          data: error.response.data,
          headers: error.response.headers
        });
      } else if (error.request) {
        console.error('authService: Requisição enviada mas sem resposta:', error.request);
      } else {
        console.error('authService: Erro ao configurar requisição:', error.message);
      }
      throw error;
    }
  },
  
  /**
   * Registrar novo usuário (cliente ou terapeuta)
   */
  register: async (userData) => {
    try {
      const response = await api.post('/auth/register', userData);
      return response.data;
    } catch (error) {
      console.error('Erro de registro:', error);
      throw error;
    }
  },
  
  /**
   * Logout de usuário
   */
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },
  
  /**
   * Verifica se o usuário está autenticado
   */
  isAuthenticated: () => {
    const token = localStorage.getItem('token');
    return !!token;
  },
  
  /**
   * Obter usuário atual
   */
  getCurrentUser: () => {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
  },
  
  /**
   * Obter token JWT
   */
  getToken: () => {
    return localStorage.getItem('token');
  },
  
  /**
   * Verificar se o usuário tem uma determinada função
   */
  hasRole: (role) => {
    const user = authService.getCurrentUser();
    return user && user.role === role;
  },
  
  /**
   * Verificar se o usuário é administrador
   */
  isAdmin: () => {
    return authService.hasRole('ADMIN');
  }
};

export default authService; 