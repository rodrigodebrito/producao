/**
 * Serviço para gerenciar videoconferências usando Daily.co
 * 
 * Este serviço lida com a criação, configuração e gerenciamento
 * de sessões de videoconferência através da API do backend,
 * que se integra com a plataforma Daily.co
 */

import api from './api';
import { toast } from 'react-toastify';

/**
 * Cria uma reunião para uma sessão específica
 * @param {string} sessionId - ID da sessão para a qual criar a reunião
 * @param {string} title - Título opcional da reunião
 * @returns {Promise<Object>} - Detalhes da reunião criada
 */
export const createMeeting = async (sessionId, title = '') => {
  try {
    console.log('Criando reunião para a sessão:', sessionId);
    const response = await api.post('/meetings', {
      sessionId,
      title
    });
    console.log('Reunião criada:', response.data);
    return response.data;
  } catch (error) {
    console.error('Erro ao criar reunião:', error);
    
    // Tratar erros específicos de permissão
    if (error.response && error.response.status === 403) {
      const errorMessage = error.response.data.message || 'Você não tem permissão para criar salas de videoconferência.';
      toast.error(errorMessage);
    }
    
    throw error;
  }
};

/**
 * Entra em uma reunião existente para uma sessão
 * @param {string} sessionId - ID da sessão
 * @returns {Promise<Object>} - Token de acesso e detalhes da reunião
 */
export const joinMeeting = async (sessionId) => {
  try {
    console.log('Entrando na reunião para a sessão:', sessionId);
    const response = await api.get(`/meetings/${sessionId}/join`);
    console.log('Token de acesso gerado:', response.data);
    
    // Garantir que o URL não tenha prefixo "tc-" que causa problemas com Daily.co
    if (response.data && response.data.roomName) {
      // Limpeza do URL para compatibilidade com o Daily.co
      response.data.roomName = response.data.roomName.replace('/tc-', '/');
      
      // Verificar se o URL ainda contém o domínio correto
      if (!response.data.roomName.includes('teraconect.daily.co')) {
        console.warn('URL da sala não contém o domínio correto, ajustando...');
        
        // Extrair o nome da sala (último segmento da URL)
        const roomNameSegment = response.data.roomName.split('/').pop();
        // Reconstruir URL com domínio correto
        response.data.roomName = `https://teraconect.daily.co/${roomNameSegment}`;
      }
      
      console.log('URL da sala processado:', response.data.roomName);
    }
    
    return response.data;
  } catch (error) {
    // Tratar erros específicos
    if (error.response) {
      const { status, data } = error.response;
      
      // Sala não existe e terapeuta pode criar
      if (status === 404) {
        // Verificar se o usuário atual é terapeuta antes de tentar criar
        const userRole = localStorage.getItem('userRole') || '';
        if (userRole.toUpperCase() === 'THERAPIST') {
          console.log('Sala não encontrada, tentando criar como terapeuta para a sessão:', sessionId);
          try {
            // Chamar createMeeting para criar uma nova sala
            const newMeeting = await createMeeting(sessionId);
            console.log('Nova sala criada:', newMeeting);
            
            // Tentar entrar na sala novamente
            return await joinMeeting(sessionId);
          } catch (createError) {
            console.error('Erro ao criar e entrar na reunião:', createError);
            toast.error('Não foi possível criar a sala de videoconferência. Por favor, tente novamente.');
            throw createError;
          }
        } else {
          // Cliente não pode criar salas
          toast.error('A sala de videoconferência ainda não foi criada pelo terapeuta.');
          throw new Error('Aguarde o terapeuta iniciar a sessão.');
        }
      }
      
      // Erros de permissão/acesso
      if (status === 403) {
        const errorMessage = data.message || 'Você não tem permissão para acessar esta sala.';
        toast.error(errorMessage);
        
        // Se for erro de horário para cliente, fornecer informações adicionais
        if (errorMessage.includes('horário agendado')) {
          // Verificar se temos dados do agendamento
          try {
            const { appointment } = data;
            if (appointment && appointment.dateTime) {
              const appointmentTime = new Date(appointment.dateTime);
              const formattedTime = appointmentTime.toLocaleString();
              toast.info(`Seu agendamento é para ${formattedTime}. Você poderá acessar 5 minutos antes.`);
            }
          } catch (e) {
            console.error('Erro ao processar informações de agendamento:', e);
          }
        }
        
        throw new Error(errorMessage);
      }
    }
    
    console.error('Erro ao entrar na reunião:', error);
    toast.error('Erro ao acessar a sala de videoconferência. Por favor, tente novamente.');
    throw error;
  }
};

/**
 * Encerra uma reunião ativa
 * @param {string} sessionId - ID da sessão
 * @returns {Promise<Object>} - Confirmação de encerramento
 */
export const endMeeting = async (sessionId) => {
  try {
    console.log('Encerrando reunião da sessão:', sessionId);
    const response = await api.post(`/meetings/${sessionId}/end`);
    console.log('Reunião encerrada:', response.data);
    return response.data;
  } catch (error) {
    console.error('Erro ao encerrar reunião:', error);
    
    // Tratar erros de permissão para encerrar reunião
    if (error.response && error.response.status === 403) {
      toast.error('Apenas o terapeuta pode encerrar a reunião.');
    } else {
      toast.error('Erro ao encerrar a reunião. Por favor, tente novamente.');
    }
    
    throw error;
  }
};

/**
 * Verifica o status atual de uma reunião
 * @param {string} sessionId - ID da sessão
 * @returns {Promise<Object>} - Status da reunião
 */
export const getMeetingStatus = async (sessionId) => {
  try {
    const response = await api.get(`/meetings/${sessionId}/status`);
    return response.data;
  } catch (error) {
    console.error('Erro ao verificar status da reunião:', error);
    throw error;
  }
};

/**
 * Valida/cria uma sala de videoconferência através do backend
 * @param {string} roomName - Nome da sala para validar/criar
 * @returns {Promise<Object>} - Detalhes da sala criada
 */
export const validateRoom = async (roomName) => {
  try {
    console.log(`Validando sala: ${roomName}`);
    const response = await api.get(`/meetings/validate-room/${roomName}`);
    console.log('Sala validada:', response.data);
    return response.data;
  } catch (error) {
    console.error('Erro ao validar sala:', error);
    
    // Se o erro for de permissão
    if (error.response && error.response.status === 403) {
      const message = error.response.data.message || 'Apenas terapeutas podem validar salas';
      toast.error(message);
    }
    
    throw error;
  }
};

export default {
  getSessionById,
  markSessionCompleted,
  startSession,
  cancelSession,
  rescheduleSession,
  createRobustSession,
  createTestSession,
  createMeeting,
  joinMeeting,
  endMeeting,
  getMeetingStatus,
  validateRoom
}; 