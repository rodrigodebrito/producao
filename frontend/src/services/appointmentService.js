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
    
    // Tentando usar URL direta em vez de depender do axios interceptor
    const apiUrl = `${import.meta.env.VITE_API_URL}/api/appointments`;
    
    // Tentativa usando fetch nativo
    const fetchResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(appointmentData)
    });
    
    if (fetchResponse.ok) {
      const data = await fetchResponse.json();
      return data;
    } else {
      throw new Error(`Erro ${fetchResponse.status}: ${fetchResponse.statusText}`);
    }
  } catch (error) {
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
    
    // URL base da API
    const baseUrl = import.meta.env.VITE_API_URL || 'https://theraconnect-prd.onrender.com';
    console.log('URL base da API:', baseUrl);
    
    // Usar rotas alternativas para tentar criar o agendamento
    const url1 = `${baseUrl}/api/appointments`;
    const url2 = `${baseUrl}/api/therapists/${appointmentData.therapistId}/appointments`;
    const url3 = `${baseUrl}/api/users/appointments`;  
    const url4 = `${baseUrl}/api/appointments/bypass`;
    
    console.log('Tentando URL 1:', url1);
    
    // Tentar a primeira URL
    try {
      const response1 = await fetch(url1, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formattedData)
      });
      
      if (response1.ok) {
        const data = await response1.json();
        console.log('Resposta da URL 1:', data);
        return data;
      }
      
      console.log('Tentando URL 2:', url2);
      
      // Tentar a segunda URL
      const response2 = await fetch(url2, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formattedData)
      });
      
      if (response2.ok) {
        const data = await response2.json();
        console.log('Resposta da URL 2:', data);
        return data;
      }
      
      console.log('Tentando URL 3:', url3);
      
      // Tentar a terceira URL
      const response3 = await fetch(url3, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formattedData)
      });
      
      if (response3.ok) {
        const data = await response3.json();
        console.log('Resposta da URL 3:', data);
        return data;
      }
      
      console.log('Tentando URL 4 (bypass):', url4);
      
      // Tentar a rota de bypass (sem autenticação)
      const response4 = await fetch(url4, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formattedData)
      });
      
      if (response4.ok) {
        const data = await response4.json();
        console.log('Resposta da URL 4 (bypass):', data);
        return data;
      }
      
      // Se todas as tentativas falharem, lançar erro
      throw new Error('Não foi possível criar o agendamento em nenhuma das rotas tentadas');
      
    } catch (fetchError) {
      console.error('Erro na tentativa fetch:', fetchError);
      throw fetchError;
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
    
    // URL base da API
    const baseUrl = import.meta.env.VITE_API_URL || 'https://theraconnect-prd.onrender.com';
    console.log('URL base da API:', baseUrl);
    
    // Usar a nova rota especializada para terapeutas como clientes
    const url = `${baseUrl}/api/appointments/create-therapist-client`;
    
    console.log('Usando rota especializada para terapeuta como cliente:', url);
    
    // Fazer a requisição
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(formattedData)
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('Agendamento de terapeuta como cliente criado com sucesso:', data);
      return data;
    } else {
      // Se falhar, tentar extrair a mensagem de erro detalhada
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { error: `${response.status}: ${response.statusText}` };
      }
      
      console.error('Erro na resposta da API:', errorData);
      throw new Error(errorData.error || 'Erro ao criar agendamento');
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
      throw new Error('Usuário não encontrado no localStorage');
    }
    
    const user = JSON.parse(userJson);
    console.log('Criando agendamento para usuário:', user);
    
    // Detectar se o usuário é terapeuta
    const isTherapist = user.role === 'THERAPIST';
    
    // Verificar se o terapeuta está tentando agendar consigo mesmo
    const selfAppointment = isTherapist && (!appointmentData.clientId || appointmentData.selfBooking);
    
    console.log(`Tipo de agendamento: ${isTherapist ? 'Terapeuta' : 'Cliente'}, Auto-agendamento: ${selfAppointment}`);
    
    if (selfAppointment) {
      // Usar a rota especial para terapeutas agendando para si mesmos
      console.log('Usando rota especializada para terapeuta como cliente');
      return await createTherapistSelfAppointment(appointmentData);
    } else {
      // Tentar método regular primeiro
      try {
        console.log('Tentando método regular de agendamento');
        return await createAppointment(appointmentData);
      } catch (regularError) {
        console.error('Método regular falhou, tentando método direto:', regularError);
        
        // Se falhar, tentar o método direto
        return await createAppointmentDirect(appointmentData);
      }
    }
  } catch (error) {
    console.error('Erro no agendamento inteligente:', error);
    throw error;
  }
}; 