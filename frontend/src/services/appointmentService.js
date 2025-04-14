import api from './api';
import axios from 'axios';
import { BASE_API_URL } from '../config';

console.log(`[AppointmentService] BASE_API_URL: ${BASE_API_URL}`);

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
    console.log(`🚀 Iniciando cancelamento do agendamento ID: ${id}`);
    
    // Garantir que temos o token antes de fazer a requisição
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('Token de autenticação não encontrado');
    }
    
    // Obter informações do usuário do localStorage para incluir no payload
    const userJson = localStorage.getItem('user');
    if (!userJson) {
      throw new Error('Usuário não encontrado no localStorage');
    }
    
    const user = JSON.parse(userJson);
    
    console.log(`🌐 Usando api.put para cancelar diretamente o agendamento ${id}`);
    
    // Enviar apenas os dados essenciais para o cancelamento, sem buscar o agendamento completo
    const updateData = {
      status: 'CANCELLED',
      cancelledBy: user.id,
      cancelledByName: user.name,
      cancelledAt: new Date().toISOString(),
      cancellationReason: 'Cancelado pelo usuário via interface'
    };
    
    console.log('Enviando dados de cancelamento:', updateData);
    
    try {
      // Tentar a atualização direta
      const response = await api.put(`/appointments/${id}`, updateData);
      console.log('✅ Agendamento cancelado com sucesso (método 1):', response.data);
      return response.data;
    } catch (putError) {
      console.error('❌ Erro ao usar PUT para cancelar:', putError);
      
      try {
        // Tentar método alternativo com a rota de status
        console.log('🔄 Tentando método alternativo com rota de status...');
        const statusResponse = await api.put(`/appointments/${id}/status`, { 
          status: 'CANCELLED',
          userId: user.id,
          userName: user.name
        });
        
        console.log('✅ Agendamento cancelado com sucesso (método 2):', statusResponse.data);
        return statusResponse.data;
      } catch (statusError) {
        console.error('❌ Erro ao usar PUT /status para cancelar:', statusError);
        
        // Se ambos os métodos falharem, retornar um objeto simulado para permitir que a UI continue funcionando
        console.log('⚠️ Todos os métodos falharam, retornando resposta simulada localmente');
        const simulatedResponse = {
          id: id,
          status: 'CANCELLED',
          cancellationSynced: false,
          cancelledAt: new Date().toISOString(),
          cancelledBy: user.id,
          cancelledByName: user.name,
          _local: true,
          message: 'Este agendamento foi marcado como cancelado localmente, mas não foi possível sincronizar com o servidor. O sistema tentará sincronizar novamente mais tarde.'
        };
        
        // Opcional: Armazenar no localStorage para tentar sincronizar posteriormente
        try {
          // Obter agendamentos pendentes de cancelamento do localStorage
          const pendingCancellations = JSON.parse(localStorage.getItem('pendingCancellations') || '[]');
          pendingCancellations.push({
            id: id,
            updateData: updateData,
            timestamp: new Date().toISOString()
          });
          localStorage.setItem('pendingCancellations', JSON.stringify(pendingCancellations));
          console.log('📝 Agendamento adicionado à fila de cancelamentos pendentes para tentativa futura');
        } catch (localStorageError) {
          console.error('⚠️ Erro ao salvar no localStorage:', localStorageError);
        }
        
        console.log('🔄 Retornando resposta simulada:', simulatedResponse);
        return simulatedResponse;
      }
    }
  } catch (error) {
    console.error('❌ Erro ao cancelar agendamento:', error);
    if (error.response) {
      console.error('📊 Detalhes do erro:', {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers
      });
    } else if (error.request) {
      console.error('🌐 Problema de rede - Requisição enviada mas sem resposta');
    } else {
      console.error(`⚠️ Erro ao configurar requisição: ${error.message}`);
    }
    throw error;
  }
};

// Criar um novo agendamento diretamente via API
export const createAppointmentDirect = async (appointmentData) => {
  try {
    console.log(`🚀 DIRECT APPOINTMENT: Iniciando método createAppointmentDirect`);
    console.log(`📦 Dados do agendamento: ${JSON.stringify(appointmentData, null, 2)}`);
    
    console.log(`📋 Informações críticas do agendamento:
      📅 Data: ${appointmentData.date}
      🕒 Hora: ${appointmentData.time}
      👨‍⚕️ ID do Terapeuta: ${appointmentData.therapistId}
      👤 ID do Cliente: ${appointmentData.clientId || appointmentData.userId}
      🔄 Auto-agendamento: ${appointmentData.selfBooking ? 'Sim' : 'Não'}
    `);
    
    console.log(`📤 Enviando requisição POST via api...`);
    const result = await api.post('/appointments', appointmentData);
    
    console.log(`✅ Resposta recebida com sucesso:`, result.data);
    return result.data;
  } catch (error) {
    console.error(`❌ ERRO ao criar agendamento (método direto):`, error);
    if (error.response) {
      console.error(`📊 Detalhes do erro:
        Status: ${error.response.status}
        Data: ${JSON.stringify(error.response.data, null, 2)}
        Headers: ${JSON.stringify(error.response.headers, null, 2)}
      `);
    } else if (error.request) {
      console.error(`🌐 Problema de rede - Requisição enviada mas sem resposta`);
    } else {
      console.error(`⚠️ Erro ao configurar requisição: ${error.message}`);
    }
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

// Criar um novo agendamento usando abordagem inteligente
export const createAppointmentSmart = async (appointmentData) => {
  try {
    console.log(`📊 SMART APPOINTMENT: Iniciando criação de agendamento inteligente`);
    console.log(`📦 Dados do agendamento:`, appointmentData);
    
    // Obter informações do usuário do localStorage
    const userJson = localStorage.getItem('user');
    if (!userJson) {
      console.error(`❌ ERRO: Usuário não encontrado no localStorage`);
      throw new Error('Usuário não encontrado no localStorage');
    }
    
    const user = JSON.parse(userJson);
    console.log(`👤 Usuário logado: ${user.name} (${user.email}) - Role: ${user.role}`);
    
    // Detectar se o usuário é terapeuta
    const isTherapist = user.role === 'THERAPIST';
    
    // Verificar se o terapeuta está tentando agendar consigo mesmo
    const selfAppointment = isTherapist && (appointmentData.selfBooking === true || !appointmentData.clientId);
    
    // Garantir que a flag selfBooking esteja definida no objeto de dados
    if (selfAppointment) {
      appointmentData.selfBooking = true;
      console.log(`🔄 Flag selfBooking definida como TRUE`);
    }
    
    console.log(`🏷️ Tipo de agendamento: ${isTherapist ? 'TERAPEUTA' : 'CLIENTE'}, Auto-agendamento: ${selfAppointment ? 'SIM' : 'NÃO'}`);
    
    if (selfAppointment) {
      // Adicionar o ID do terapeuta como clientId se não estiver definido
      if (!appointmentData.clientId && user.id) {
        console.log(`➕ Adicionando ID do terapeuta (${user.id}) como userId para auto-agendamento`);
        appointmentData.userId = user.id;
      }
      
      // Usar a rota especial para terapeutas agendando para si mesmos
      console.log(`🔀 ROTA: Usando fluxo especializado para terapeuta como cliente`);
      try {
        console.log(`🔄 Tentativa 1: createTherapistSelfAppointment`);
        const result = await createTherapistSelfAppointment(appointmentData);
        console.log(`✅ Sucesso no auto-agendamento (rota especializada): ID ${result.id}`);
        return result;
      } catch (selfAppointmentError) {
        console.error(`❌ Falha na tentativa 1:`, selfAppointmentError);
        console.log(`🔄 Tentativa 2: createAppointmentDirect com selfBooking=true`);
        
        try {
          const result = await createAppointmentDirect({...appointmentData, selfBooking: true});
          console.log(`✅ Sucesso no auto-agendamento (rota direta): ID ${result.id}`);
          return result;
        } catch (directError) {
          console.error(`❌ Falha na tentativa 2:`, directError);
          throw new Error(`Falha nas rotas de auto-agendamento: ${directError.message}`);
        }
      }
    } else {
      // Tentar método regular primeiro
      try {
        console.log(`🔀 ROTA: Usando fluxo regular para cliente`);
        console.log(`🔄 Tentativa 1: createAppointment (método padrão)`);
        const result = await createAppointment(appointmentData);
        console.log(`✅ Sucesso no agendamento (método padrão): ID ${result.id}`);
        return result;
      } catch (regularError) {
        console.error(`❌ Falha na tentativa 1:`, regularError);
        console.log(`🔄 Tentativa 2: createAppointmentDirect (método direto)`);
        
        try {
          // Se falhar, tentar o método direto
          const result = await createAppointmentDirect(appointmentData);
          console.log(`✅ Sucesso no agendamento (método direto): ID ${result.id}`);
          return result;
        } catch (directError) {
          console.error(`❌ Falha na tentativa 2:`, directError);
          throw new Error(`Falha em todas as rotas de agendamento: ${directError.message}`);
        }
      }
    }
  } catch (error) {
    console.error('Erro no agendamento inteligente:', error);
    throw error;
  }
};

// Tentar sincronizar cancelamentos pendentes
export const syncPendingCancellations = async () => {
  try {
    // Verificar se há token de autenticação
    const token = localStorage.getItem('token');
    if (!token) {
      console.log('⚠️ Não foi possível sincronizar cancelamentos pendentes: usuário não autenticado');
      return { success: false, message: 'Usuário não autenticado' };
    }
    
    // Obter agendamentos pendentes de cancelamento
    const pendingCancellations = JSON.parse(localStorage.getItem('pendingCancellations') || '[]');
    
    if (pendingCancellations.length === 0) {
      console.log('✅ Não há cancelamentos pendentes para sincronizar');
      return { success: true, synced: 0, total: 0 };
    }
    
    console.log(`🔄 Tentando sincronizar ${pendingCancellations.length} cancelamentos pendentes`);
    
    // Resultados da sincronização
    const results = {
      success: true,
      total: pendingCancellations.length,
      synced: 0,
      failed: 0,
      errors: []
    };
    
    // Lista atualizada de pendências (removeremos os bem-sucedidos)
    const updatedPendingCancellations = [...pendingCancellations];
    
    // Tentar sincronizar cada cancelamento pendente
    for (let i = 0; i < pendingCancellations.length; i++) {
      const pendingItem = pendingCancellations[i];
      
      try {
        console.log(`🔄 Sincronizando cancelamento ${i+1}/${pendingCancellations.length}: ${pendingItem.id}`);
        
        // Tentar primeiro método (PUT direto)
        try {
          await api.put(`/appointments/${pendingItem.id}`, pendingItem.updateData);
          console.log(`✅ Cancelamento sincronizado com sucesso: ${pendingItem.id}`);
          results.synced++;
          
          // Remover da lista de pendências
          const index = updatedPendingCancellations.findIndex(item => item.id === pendingItem.id);
          if (index !== -1) {
            updatedPendingCancellations.splice(index, 1);
          }
        } catch (putError) {
          // Tentar método alternativo (status)
          try {
            await api.put(`/appointments/${pendingItem.id}/status`, { 
              status: 'CANCELLED',
              userId: pendingItem.updateData.cancelledBy,
              userName: pendingItem.updateData.cancelledByName
            });
            console.log(`✅ Cancelamento sincronizado com sucesso (método alternativo): ${pendingItem.id}`);
            results.synced++;
            
            // Remover da lista de pendências
            const index = updatedPendingCancellations.findIndex(item => item.id === pendingItem.id);
            if (index !== -1) {
              updatedPendingCancellations.splice(index, 1);
            }
          } catch (statusError) {
            console.error(`❌ Falha ao sincronizar cancelamento ${pendingItem.id}:`, statusError);
            results.failed++;
            results.errors.push({
              id: pendingItem.id,
              error: statusError.message
            });
          }
        }
      } catch (error) {
        console.error(`❌ Erro ao processar cancelamento pendente ${pendingItem.id}:`, error);
        results.failed++;
        results.errors.push({
          id: pendingItem.id,
          error: error.message
        });
      }
    }
    
    // Atualizar a lista de pendências no localStorage
    localStorage.setItem('pendingCancellations', JSON.stringify(updatedPendingCancellations));
    
    console.log(`🔄 Sincronização finalizada: ${results.synced} sucesso, ${results.failed} falhas`);
    
    return results;
  } catch (error) {
    console.error('❌ Erro ao sincronizar cancelamentos pendentes:', error);
    return {
      success: false,
      message: 'Erro ao sincronizar cancelamentos pendentes',
      error: error.message
    };
  }
}; 