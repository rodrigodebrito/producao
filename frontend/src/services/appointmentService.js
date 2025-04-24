import api from './api';
import axios from 'axios';
import { BASE_API_URL } from '../config';
import { toISOWithTimezone, formatDateToIso } from '../utils/dateUtils';

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
    
    // Normalizar o formato da data usando a função utilitária
    const normalizedDate = formatDateToIso(date);
    
    // Extrair componentes da data normalizada
    if (normalizedDate) {
      [year, month, day] = normalizedDate.split('-').map(Number);
    } else {
      throw new Error(`Formato de data não reconhecido: ${date}`);
    }
    
    // Formatar para uso na API
    const formattedDate = normalizedDate;
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

// Obter todos os agendamentos do usuário
export const getAppointments = async () => {
  console.log('Buscando agendamentos no appointmentService...');
  const token = localStorage.getItem('token');
  
  if (!token) {
    console.error('Token não encontrado ao buscar agendamentos');
    throw new Error('Não autorizado. Faça login novamente.');
  }
  
  try {
    // Usar o endpoint correto /appointments
    console.log('Tentando buscar agendamentos do endpoint: /appointments');
    const response = await api.get('/appointments', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    
    console.log(`Resposta recebida com ${response.data?.length || 0} agendamentos`);
    return response.data;
  } catch (error) {
    console.error('Erro ao buscar agendamentos do endpoint primário:', error);
    
    // Tentar endpoint alternativo como fallback
    try {
      console.log('Tentando endpoint alternativo: /api/appointments');
      const alternativeResponse = await api.get('/api/appointments', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      
      console.log(`Resposta do endpoint alternativo recebida com ${alternativeResponse.data?.length || 0} agendamentos`);
      return alternativeResponse.data;
    } catch (fallbackError) {
      console.error('Erro também no endpoint alternativo:', fallbackError);
      
      // Construir mensagem de erro informativa
      let errorMessage = 'Erro ao buscar agendamentos';
      
      if (error.response) {
        // Erro do servidor com resposta
        errorMessage += `: ${error.response.status} - ${error.response.data?.message || error.response.statusText}`;
      } else if (error.request) {
        // Sem resposta do servidor
        errorMessage += ': Sem resposta do servidor. Verifique sua conexão.';
      } else {
        // Erro na configuração da requisição
        errorMessage += `: ${error.message}`;
      }
      
      throw new Error(errorMessage);
    }
  }
};

// Obter um agendamento específico
export const getAppointmentById = async (id) => {
  const token = localStorage.getItem('token');
  
  if (!token) {
    throw new Error('Não autorizado. Faça login novamente.');
  }
  
  try {
    const response = await api.get(`/appointments/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Erro ao buscar agendamento específico:', error);
    throw new Error(error.response?.data?.message || 'Erro ao buscar detalhes do agendamento');
  }
};

// Criar um novo agendamento
export const createAppointment = async (appointmentData) => {
  const token = localStorage.getItem('token');
  
  if (!token) {
    throw new Error('Não autorizado. Faça login novamente.');
  }
  
  try {
    const response = await api.post('/appointments', appointmentData, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Erro ao criar agendamento:', error);
    throw new Error(error.response?.data?.message || 'Erro ao criar agendamento');
  }
};

// Atualizar um agendamento existente
export const updateAppointment = async (id, appointmentData) => {
  const token = localStorage.getItem('token');
  
  if (!token) {
    throw new Error('Não autorizado. Faça login novamente.');
  }
  
  try {
    const response = await api.put(`/appointments/${id}`, appointmentData, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Erro ao atualizar agendamento:', error);
    throw new Error(error.response?.data?.message || 'Erro ao atualizar agendamento');
  }
};

// Atualizar o status de um agendamento
export const updateAppointmentStatus = async (id, status) => {
  const token = localStorage.getItem('token');
  
  if (!token) {
    throw new Error('Não autorizado. Faça login novamente.');
  }
  
  try {
    const response = await api.patch(`/appointments/${id}/status`, { status }, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Erro ao atualizar status do agendamento:', error);
    throw new Error(error.response?.data?.message || 'Erro ao atualizar status do agendamento');
  }
};

// Excluir um agendamento
export const deleteAppointment = async (id) => {
  const token = localStorage.getItem('token');
  
  if (!token) {
    throw new Error('Não autorizado. Faça login novamente.');
  }
  
  try {
    const response = await api.delete(`/appointments/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Erro ao excluir agendamento:', error);
    throw new Error(error.response?.data?.message || 'Erro ao excluir agendamento');
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
      cancelledAt: toISOWithTimezone(new Date()),
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
    
    // Definir tempo máximo para manter tentativas (7 dias em milissegundos)
    const MAX_RETRY_AGE = 7 * 24 * 60 * 60 * 1000; // 7 dias
    const now = new Date().getTime();
    
    // Filtrar agendamentos muito antigos para evitar tentativas infinitas
    const filteredPendingCancellations = pendingCancellations.filter(item => {
      const timestamp = new Date(item.timestamp).getTime();
      const age = now - timestamp;
      
      // Se for muito antigo, vamos remover
      if (age > MAX_RETRY_AGE) {
        console.log(`⏱️ Removendo cancelamento pendente antigo: ${item.id} (idade: ${Math.round(age / (24 * 60 * 60 * 1000))} dias)`);
        return false;
      }
      return true;
    });
    
    // Se removemos alguns itens antigos, atualizar imediatamente
    if (filteredPendingCancellations.length < pendingCancellations.length) {
      const removedCount = pendingCancellations.length - filteredPendingCancellations.length;
      console.log(`🧹 Removidos ${removedCount} cancelamentos pendentes antigos (> 7 dias)`);
      localStorage.setItem('pendingCancellations', JSON.stringify(filteredPendingCancellations));
      
      // Se não sobrou nada para sincronizar após a limpeza
      if (filteredPendingCancellations.length === 0) {
        console.log('✅ Não há mais cancelamentos pendentes válidos para sincronizar');
        return { 
          success: true, 
          synced: 0, 
          total: 0,
          cleaned: removedCount,
          message: `${removedCount} cancelamentos antigos foram removidos da fila`
        };
      }
    }
    
    // Resultados da sincronização
    const results = {
      success: true,
      total: filteredPendingCancellations.length,
      synced: 0,
      failed: 0,
      cleaned: pendingCancellations.length - filteredPendingCancellations.length,
      errors: []
    };
    
    // Lista atualizada de pendências (removeremos os bem-sucedidos)
    const updatedPendingCancellations = [...filteredPendingCancellations];
    
    // Limitar a 3 tentativas por vez para evitar sobrecarga e bloquear a interface
    const MAX_SYNC_ATTEMPTS = 3;
    const attemptsCount = Math.min(filteredPendingCancellations.length, MAX_SYNC_ATTEMPTS);
    
    if (filteredPendingCancellations.length > MAX_SYNC_ATTEMPTS) {
      console.log(`⚠️ Limitando a ${MAX_SYNC_ATTEMPTS} tentativas por vez (total: ${filteredPendingCancellations.length})`);
    }
    
    // Tentar sincronizar cada cancelamento pendente (limitado)
    for (let i = 0; i < attemptsCount; i++) {
      const pendingItem = filteredPendingCancellations[i];
      
      try {
        console.log(`🔄 Sincronizando cancelamento ${i+1}/${attemptsCount}: ${pendingItem.id}`);
        
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
          // Verificar se é erro 404 (agendamento não existe mais)
          if (putError.response && putError.response.status === 404) {
            console.log(`🗑️ Agendamento ${pendingItem.id} não encontrado (404), removendo da fila`);
            
            // Remover da lista de pendências se for 404
            const index = updatedPendingCancellations.findIndex(item => item.id === pendingItem.id);
            if (index !== -1) {
              updatedPendingCancellations.splice(index, 1);
            }
            
            // Não contar como falha
            results.cleaned++;
            continue;
          }
          
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
            // Verificar se também é 404 na rota alternativa
            if (statusError.response && statusError.response.status === 404) {
              console.log(`🗑️ Agendamento ${pendingItem.id} não encontrado (404) na rota alternativa, removendo da fila`);
              
              // Remover da lista de pendências
              const index = updatedPendingCancellations.findIndex(item => item.id === pendingItem.id);
              if (index !== -1) {
                updatedPendingCancellations.splice(index, 1);
              }
              
              // Não contar como falha
              results.cleaned++;
              continue;
            }
            
            console.error(`❌ Falha ao sincronizar cancelamento ${pendingItem.id}:`, statusError);
            
            // Incrementar o contador de tentativas no item
            const index = updatedPendingCancellations.findIndex(item => item.id === pendingItem.id);
            if (index !== -1) {
              // Se já tem contagem de tentativas, incrementar
              updatedPendingCancellations[index].attempts = (updatedPendingCancellations[index].attempts || 0) + 1;
              
              // Se já tentou mais de 5 vezes, remover da fila
              if (updatedPendingCancellations[index].attempts >= 5) {
                console.log(`🚫 Cancelamento ${pendingItem.id} falhou 5 vezes, removendo da fila`);
                updatedPendingCancellations.splice(index, 1);
                results.cleaned++;
                continue;
              }
            }
            
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
    
    console.log(`🔄 Sincronização finalizada: ${results.synced} sucesso, ${results.failed} falhas, ${results.cleaned} removidos`);
    
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