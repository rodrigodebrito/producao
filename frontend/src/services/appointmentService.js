import api from './api';

// Obter agendamentos do terapeuta
export const getTherapistAppointments = async (therapistId) => {
  try {
    const response = await api.get(`/appointments/therapist/${therapistId}`);
    return response.data;
  } catch (error) {
    console.error('Erro ao buscar agendamentos do terapeuta:', error);
    throw error;
  }
};

// Obter agendamentos do cliente
export const getClientAppointments = async (clientId) => {
  try {
    const response = await api.get(`/appointments/client/${clientId}`);
    return response.data;
  } catch (error) {
    console.error('Erro ao buscar agendamentos do cliente:', error);
    throw error;
  }
};

// Verificar disponibilidade de um terapeuta para o mês
export const getTherapistAvailability = async (therapistId, month, year) => {
  try {
    const response = await api.get(`/therapists/${therapistId}/availability`, {
      params: { month, year }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching therapist availability:', error);
    throw error;
  }
};

// Obter horários disponíveis para uma data específica
export const getAvailableTimeSlots = async (therapistId, date) => {
  try {
    // Garantir que temos o formato correto para a requisição
    console.log(`[API] Iniciando busca de slots para terapeuta ${therapistId} na data ${date}`);
    
    let year, month, day;
    
    // Normalizar o formato da data
    if (date instanceof Date) {
      year = date.getFullYear();
      month = date.getMonth() + 1; // Mês é base 0 em JS
      day = date.getDate();
    } else if (typeof date === 'string') {
      if (date.includes('-')) {
        // Formato ISO (YYYY-MM-DD)
        [year, month, day] = date.split('-').map(Number);
      } else if (date.includes('/')) {
        // Formato brasileiro (DD/MM/YYYY)
        [day, month, year] = date.split('/').map(Number);
      } else {
        throw new Error(`Formato de data não reconhecido: ${date}`);
      }
    } else {
      throw new Error(`Tipo de data não suportado: ${typeof date}`);
    }
    
    // Formatar para uso na API
    const formattedDate = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    console.log(`[API] Data formatada para request: ${formattedDate}`);
    
    // Fazer a requisição
    const response = await api.get(`/therapists/${therapistId}/availability`, {
      params: { 
        month, 
        year,
        // Adicionar day como parâmetro opcional, caso a API suporte filtro por dia específico
        day
      }
    });
    
    // Log para debug
    console.log(`[API] Resposta para disponibilidade de ${formattedDate}:`, response.data);
    
    // Filtrar apenas os slots para o dia específico
    const slots = Array.isArray(response.data) 
      ? response.data
          .filter(slot => slot.date === formattedDate)
          .map(slot => slot.startTime)
      : [];
    
    console.log(`[API] ${slots.length} slots encontrados para ${formattedDate}:`, slots);
    return slots;
  } catch (error) {
    console.error(`[API] Erro ao buscar horários para ${date}:`, error);
    throw error;
  }
};

// Obter o cliente pelo userId
export const getClientByUserId = async (userId) => {
  try {
    console.log(`Buscando cliente para o userId: ${userId}`);
    const response = await api.get(`/clients/user/${userId}`);
    console.log('Dados do cliente recebidos:', response.data);
    return response.data;
  } catch (error) {
    console.error('Erro ao buscar cliente pelo userId:', error);
    throw error;
  }
};

// Criar um novo agendamento
export const createAppointment = async (appointmentData) => {
  try {
    // Garantir que temos o token antes de fazer a requisição
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('Usuário não autenticado. Por favor, faça login novamente.');
    }
    
    // Validar dados mínimos necessários
    if (!appointmentData.therapistId || 
        !appointmentData.date || !appointmentData.time || !appointmentData.toolId) {
      throw new Error('Dados incompletos para agendamento. Verifique todos os campos.');
    }
    
    console.log('Criando agendamento (método padrão) com dados:', appointmentData);
    
    // Usar o objeto api configurado
    try {
      const response = await api.post('/appointments', appointmentData);
      console.log('Resposta bem-sucedida:', response.data);
      return response.data;
    } catch (apiError) {
      console.error('Erro na tentativa com API:', apiError);
      throw apiError;
    }
  } catch (error) {
    console.error('Erro ao criar agendamento:', error);
    throw error;
  }
};

// Criar um novo agendamento (método alternativo)
export const createAppointmentAlternative = async (appointmentData) => {
  try {
    console.log('Criando agendamento (método alternativo) com dados:', appointmentData);
    
    // Garantir que temos o token antes de fazer a requisição
    const token = localStorage.getItem('token');
    if (!token) {
      console.error('Tentativa de criar agendamento sem token de autenticação');
      throw new Error('Usuário não autenticado. Por favor, faça login novamente.');
    }
    
    // Tentar criar o agendamento através do endpoint do terapeuta
    const therapistId = appointmentData.therapistId;
    console.log(`Tentando endpoint alternativo para terapeuta ${therapistId}`);
    
    // Usar o endpoint de agendamentos do terapeuta como alternativa
    const response = await api.post(`/therapists/${therapistId}/appointments`, appointmentData);
    
    console.log('Resposta da API alternativa:', response.data);
    return response.data;
  } catch (error) {
    console.error('Erro ao criar agendamento (método alternativo):', error);
    throw error;
  }
};

// Obter detalhes de um terapeuta
export const getTherapistDetails = async (therapistId) => {
  try {
    const response = await api.get(`/therapists/${therapistId}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching therapist details:', error);
    throw error;
  }
};

// Obter todos os agendamentos do usuário atual (cliente ou terapeuta)
export const getAppointments = async () => {
  try {
    console.log('Buscando todos os agendamentos do usuário');
    const response = await api.get('/appointments');
    console.log('Agendamentos obtidos:', response.data);
    return response.data;
  } catch (error) {
    console.error('Erro ao buscar agendamentos:', error);
    throw error;
  }
};

export const getAppointmentById = async (id) => {
  try {
    const response = await api.get(`/appointments/${id}`);
    return response.data;
  } catch (error) {
    console.error('Erro ao buscar agendamento:', error);
    throw error;
  }
};

export const updateAppointment = async (id, data) => {
  try {
    const response = await api.put(`/appointments/${id}`, data);
    return response.data;
  } catch (error) {
    console.error('Erro ao atualizar agendamento:', error);
    throw error;
  }
};

export const cancelAppointment = async (id) => {
  try {
    const response = await api.delete(`/appointments/${id}`);
    return response.data;
  } catch (error) {
    console.error('Erro ao cancelar agendamento:', error);
    throw error;
  }
};

// Criar um novo agendamento usando abordagem direta (bypass)
export const createAppointmentDirect = async (appointmentData) => {
  try {
    console.log('Criando agendamento (método direto) com dados:', appointmentData);
    
    // Garantir que temos o token antes de fazer a requisição
    const token = localStorage.getItem('token');
    if (!token) {
      console.error('Tentativa de criar agendamento sem token de autenticação');
      throw new Error('Usuário não autenticado. Por favor, faça login novamente.');
    }
    
    // Formatar os dados do appointment para o formato que o backend espera
    const formattedData = {
      therapistId: appointmentData.therapistId,
      clientId: appointmentData.clientId,
      date: appointmentData.date,
      time: appointmentData.time,
      toolId: appointmentData.toolId,
      mode: appointmentData.mode || 'ONLINE',
      status: 'SCHEDULED',
      price: appointmentData.price || 0,
      duration: appointmentData.duration || 50
    };
    
    console.log('Tentando criar agendamento usando bypass...');
    
    // Tentar diferentes rotas, usando o objeto api configurado
    try {
      // Primeira tentativa: rota padrão de agendamentos
      console.log('Tentativa 1: rota padrão de agendamentos');
      const response = await api.post('/appointments/bypass', formattedData);
      console.log('Agendamento criado com sucesso (tentativa 1):', response.data);
      return response.data;
    } catch (error1) {
      console.warn('Falha na primeira tentativa:', error1.message);
      
      try {
        // Segunda tentativa: via terapeuta
        console.log('Tentativa 2: via terapeuta');
        const response = await api.post(`/therapists/${appointmentData.therapistId}/appointments`, formattedData);
        console.log('Agendamento criado com sucesso (tentativa 2):', response.data);
        return response.data;
      } catch (error2) {
        console.warn('Falha na segunda tentativa:', error2.message);
        
        try {
          // Terceira tentativa: via usuário
          console.log('Tentativa 3: via usuário');
          const response = await api.post('/users/appointments', formattedData);
          console.log('Agendamento criado com sucesso (tentativa 3):', response.data);
          return response.data;
        } catch (error3) {
          console.error('Todas as tentativas falharam');
          throw new Error('Não foi possível criar o agendamento após múltiplas tentativas');
        }
      }
    }
  } catch (error) {
    console.error('Erro ao criar agendamento (método direto):', error);
    throw error;
  }
};

// Criar um novo agendamento especificamente para terapeutas que querem agendar como clientes
export const createTherapistSelfAppointment = async (appointmentData) => {
  try {
    console.log('Criando agendamento para terapeuta como cliente:', appointmentData);
    
    // Garantir que temos o token antes de fazer a requisição
    const token = localStorage.getItem('token');
    if (!token) {
      console.error('Tentativa de criar agendamento sem token de autenticação');
      throw new Error('Usuário não autenticado. Por favor, faça login novamente.');
    }
    
    // Formatar os dados do appointment para o formato que o backend espera
    const formattedData = {
      therapistId: appointmentData.therapistId,
      date: appointmentData.date,
      time: appointmentData.time,
      toolId: appointmentData.toolId,
      mode: appointmentData.mode || 'ONLINE'
    };
    
    // Adicionar a flag para indicar que é um auto-agendamento
    formattedData.selfBooking = true;
    
    console.log('Usando rota especializada para terapeuta como cliente');
    
    // Usar o objeto api configurado com a rota especializada
    try {
      const response = await api.post('/appointments/create-therapist-client', formattedData);
      console.log('Agendamento de terapeuta como cliente criado com sucesso:', response.data);
      return response.data;
    } catch (error) {
      // Se a rota especializada falhar, tentar a rota alternativa
      console.warn('Rota especializada falhou, tentando rota direta:', error.message);
      
      try {
        const altResponse = await api.post('/appointments/therapist-as-client', formattedData);
        console.log('Agendamento criado com rota alternativa:', altResponse.data);
        return altResponse.data;
      } catch (altError) {
        console.error('Todas as rotas falharam:', altError.message);
        throw new Error('Não foi possível criar o agendamento de terapeuta como cliente');
      }
    }
  } catch (error) {
    console.error('Erro ao criar agendamento para terapeuta como cliente:', error);
    throw error;
  }
};

/**
 * Função inteligente para criar agendamento, detecta se o usuário é terapeuta ou cliente
 * e usa a rota adequada para cada caso
 */
export const createAppointmentSmart = async (appointmentData) => {
  try {
    // Obter informações do usuário do localStorage
    const userJson = localStorage.getItem('user');
    if (!userJson) {
      console.error('createAppointmentSmart: Usuário não encontrado no localStorage');
      throw new Error('Usuário não encontrado no localStorage');
    }
    
    const user = JSON.parse(userJson);
    console.log('createAppointmentSmart: Criando agendamento para usuário:', user);
    
    // Detectar se o usuário é terapeuta
    const isTherapist = user.role === 'THERAPIST';
    console.log('createAppointmentSmart: Usuário é terapeuta?', isTherapist);
    
    // Verificar se o terapeuta está tentando agendar consigo mesmo
    const selfAppointment = isTherapist && (appointmentData.selfBooking === true || !appointmentData.clientId);
    console.log('createAppointmentSmart: É auto-agendamento?', selfAppointment);
    
    // Garantir que a flag selfBooking esteja definida no objeto de dados
    if (selfAppointment) {
      appointmentData.selfBooking = true;
    }
    
    console.log(`createAppointmentSmart: Tipo de agendamento: ${isTherapist ? 'Terapeuta' : 'Cliente'}, Auto-agendamento: ${selfAppointment}`);
    
    // Verificar se temos o token antes de prosseguir
    const token = localStorage.getItem('token');
    console.log('createAppointmentSmart: Token presente?', !!token);
    
    // Verificar configuração da API
    console.log('createAppointmentSmart: URL base da API:', api.defaults.baseURL);
    
    if (selfAppointment) {
      // Adicionar o ID do terapeuta como clientId se não estiver definido
      if (!appointmentData.clientId && user.id) {
        console.log('createAppointmentSmart: Adicionando ID do terapeuta como clientId para auto-agendamento:', user.id);
        appointmentData.userId = user.id;
      }
      
      // Usar a rota especial para terapeutas agendando para si mesmos
      console.log('createAppointmentSmart: Usando rota especializada para terapeuta como cliente');
      try {
        console.log('createAppointmentSmart: Chamando createTherapistSelfAppointment');
        const result = await createTherapistSelfAppointment(appointmentData);
        console.log('createAppointmentSmart: createTherapistSelfAppointment bem-sucedido:', result);
        return result;
      } catch (selfAppointmentError) {
        console.error('createAppointmentSmart: Método especializado falhou:', selfAppointmentError);
        console.log('createAppointmentSmart: Tentando método direto como fallback');
        try {
          const directResult = await createAppointmentDirect({...appointmentData, selfBooking: true});
          console.log('createAppointmentSmart: createAppointmentDirect bem-sucedido:', directResult);
          return directResult;
        } catch (directError) {
          console.error('createAppointmentSmart: Todos os métodos falharam');
          console.error('createAppointmentSmart: Erro original:', selfAppointmentError);
          console.error('createAppointmentSmart: Erro do fallback:', directError);
          throw directError;
        }
      }
    } else {
      // Tentar método regular primeiro
      try {
        console.log('createAppointmentSmart: Tentando método regular de agendamento');
        const result = await createAppointment(appointmentData);
        console.log('createAppointmentSmart: createAppointment bem-sucedido:', result);
        return result;
      } catch (regularError) {
        console.error('createAppointmentSmart: Método regular falhou:', regularError);
        
        // Se falhar, tentar o método direto
        console.log('createAppointmentSmart: Tentando método direto como fallback');
        try {
          const directResult = await createAppointmentDirect(appointmentData);
          console.log('createAppointmentSmart: createAppointmentDirect bem-sucedido:', directResult);
          return directResult;
        } catch (directError) {
          console.error('createAppointmentSmart: Todos os métodos falharam');
          console.error('createAppointmentSmart: Erro original:', regularError);
          console.error('createAppointmentSmart: Erro do fallback:', directError);
          throw directError;
        }
      }
    }
  } catch (error) {
    console.error('Erro no agendamento inteligente:', error);
    throw error;
  }
};

// Função para testar a conexão com o servidor
export const testServerConnection = async () => {
  try {
    console.log('Testando conexão com o servidor...');
    const response = await api.get('/');
    console.log('Conexão com o servidor bem-sucedida:', response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('Erro ao testar conexão com o servidor:', error);
    // Tentar outra rota caso a primeira falhe
    try {
      console.log('Tentando rota alternativa...');
      const altResponse = await api.get('/health');
      console.log('Conexão alternativa bem-sucedida:', altResponse.data);
      return { success: true, data: altResponse.data };
    } catch (altError) {
      console.error('Todas as tentativas de conexão falharam');
      return { 
        success: false, 
        error: error.message,
        hasResponse: !!error.response,
        status: error.response?.status,
        data: error.response?.data
      };
    }
  }
};

// Função especial para testar criação de agendamento com fetch nativo (sem Axios)
export const createAppointmentWithFetch = async (appointmentData) => {
  try {
    console.log('Testando criação de agendamento com fetch nativo...');
    
    // Obter o token
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('Sem token de autenticação');
    }
    
    // Configurar a requisição
    const apiUrl = `${API_URL}/appointments`;
    console.log('URL da requisição:', apiUrl);
    
    // Enviar a requisição
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(appointmentData)
    });
    
    // Processar a resposta
    const text = await response.text();
    console.log('Resposta bruta:', text);
    
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      console.warn('Não foi possível parsear a resposta como JSON:', e);
      data = { raw: text };
    }
    
    return {
      success: response.ok,
      status: response.status,
      data,
      headers: Object.fromEntries([...response.headers])
    };
  } catch (error) {
    console.error('Erro fatal na requisição fetch:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}; 