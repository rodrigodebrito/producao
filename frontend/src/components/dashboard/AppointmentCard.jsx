import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { createTimezoneSafeDate } from '../../utils/dateUtils';

const AppointmentCard = ({ appointment, currentUser, onStatusUpdate }) => {
  const navigate = useNavigate();
  
  // Verificar se a data é válida e formatá-la
  const formatDateTime = (dateString, timeFormat = false) => {
    try {
      console.log(`⚠️ DEBUG: Formatando data ${dateString} (tipo: ${typeof dateString})`);
      
      // Realizar parse da data com correções de timezone
      let date;
      let selectedDay = null;
      
      // Primeiro, tentar extrair o dia original da data
      if (typeof dateString === 'string') {
        // Se temos uma data ISO, extrair o dia diretamente da string
        if (dateString.includes('T')) {
          const isoMatch = dateString.match(/(\d{4})-(\d{2})-(\d{2})T/);
          if (isoMatch) {
            selectedDay = parseInt(isoMatch[3], 10);
            console.log(`⚠️ DEBUG: Dia extraído diretamente da ISO: ${selectedDay}`);
          }
        } 
        // Se temos data no formato YYYY-MM-DD
        else if (dateString.includes('-')) {
          const dateParts = dateString.split('-');
          if (dateParts.length === 3) {
            selectedDay = parseInt(dateParts[2], 10);
            console.log(`⚠️ DEBUG: Dia extraído de YYYY-MM-DD: ${selectedDay}`);
          }
        }
        // Se temos data no formato DD/MM/YYYY
        else if (dateString.includes('/')) {
          const dateParts = dateString.split('/');
          if (dateParts.length === 3) {
            selectedDay = parseInt(dateParts[0], 10);
            console.log(`⚠️ DEBUG: Dia extraído de DD/MM/YYYY: ${selectedDay}`);
          }
        }
      }
      
      // Verificar se o agendamento tem informações de originalDay
      if (appointment.originalDay) {
        selectedDay = parseInt(appointment.originalDay, 10);
        console.log(`⚠️ DEBUG: Usando originalDay do agendamento: ${selectedDay}`);
      }
      
      // Agora fazemos o parse normal da data
      if (typeof dateString === 'string') {
        if (dateString.includes('T')) {
          // Data em formato ISO
          console.log(`⚠️ DEBUG: Parseando data ISO - ${dateString}`);
          date = parseISO(dateString);
        } else if (dateString.includes('/')) {
          // Formato DD/MM/YYYY
          console.log(`⚠️ DEBUG: Parseando data formato brasileiro - ${dateString}`);
          const [day, month, year] = dateString.split('/').map(Number);
          date = new Date(year, month - 1, day);
        } else if (dateString.includes('-')) {
          // Formato YYYY-MM-DD
          console.log(`⚠️ DEBUG: Parseando data formato ISO sem hora - ${dateString}`);
          date = parseISO(dateString);
        } else {
          // Outro formato
          console.log(`⚠️ DEBUG: Tentando parse para formato desconhecido - ${dateString}`);
          date = new Date(dateString);
        }
      } else {
        // Se não for string, assumir Date ou timestamp
        console.log(`⚠️ DEBUG: Parseando valor não-string - ${dateString}`);
        date = new Date(dateString);
      }
      
      // Verificar se a data é válida
      if (!isValid(date)) {
        console.error(`⚠️ DEBUG: Data inválida após parse - ${dateString}`);
        return 'Data inválida';
      }
      
      // Se temos o dia original extraído e ele é diferente do dia parseado, corrigimos
      if (selectedDay !== null) {
        const parsedDay = date.getDate();
        if (selectedDay !== parsedDay) {
          console.warn(`⚠️ CORREÇÃO: Ajustando dia de ${parsedDay} para ${selectedDay}`);
          
          // Método 1: Ajuste direto na data
          const correctedDate = new Date(date);
          correctedDate.setDate(selectedDay);
          date = correctedDate;
          
          console.log(`⚠️ DEBUG: Data após correção: ${date.toISOString()}`);
        }
      }
      
      // Formatar a data corrigida
      const formattedDate = timeFormat 
        ? format(date, 'HH:mm', { locale: ptBR })
        : format(date, 'dd/MM/yyyy', { locale: ptBR });
      
      console.log(`⚠️ DEBUG: Data final formatada: ${formattedDate}`);
      return formattedDate;
    } catch (error) {
      console.error('Erro ao formatar data:', error, dateString);
      return 'Erro na data';
    }
  };
  
  // Determinar se o usuário atual é o terapeuta ou o cliente deste agendamento
  const isTherapist = currentUser?.id === appointment.therapistId || 
                      currentUser?.role === 'THERAPIST' && appointment.appointmentType === 'therapist';
  
  // Formatar o status para exibição
  const getStatusLabel = (status) => {
    switch (status?.toLowerCase()) {
      case 'scheduled':
        return 'Agendado';
      case 'completed':
        return 'Concluído';
      case 'cancelled':
        return 'Cancelado';
      case 'pending':
        return 'Pendente';
      default:
        return status || 'Desconhecido';
    }
  };
  
  // Formatação do nome da pessoa (terapeuta ou cliente)
  const personName = isTherapist ? appointment.clientName : appointment.therapistName;
  
  const handleViewDetails = () => {
    navigate(`/dashboard/appointments/${appointment.id}`);
  };
  
  const handleJoinSession = () => {
    navigate(`/session/${appointment.sessionId || appointment.id}`);
  };
  
  // Verificar se o agendamento é para hoje e está dentro do horário válido
  const isActiveSession = () => {
    try {
      const now = new Date();
      console.log(`⚠️ DEBUG isActiveSession: Data atual: ${now.toISOString()}`);

      // Extrair a data e hora do agendamento
      const appointmentDate = appointment.date;
      console.log(`⚠️ DEBUG isActiveSession: Data do agendamento (original): ${appointmentDate}`);
      
      const appointmentDateStr = typeof appointmentDate === 'string' ? 
        appointmentDate.split('T')[0] : 
        format(new Date(appointmentDate), 'yyyy-MM-dd');
        
      console.log(`⚠️ DEBUG isActiveSession: Data extraída: ${appointmentDateStr}`);
      
      const appointmentTimeStr = typeof appointmentDate === 'string' ?
        appointmentDate.includes('T') ? format(parseISO(appointmentDate), 'HH:mm') : '00:00' :
        format(new Date(appointmentDate), 'HH:mm');
        
      console.log(`⚠️ DEBUG isActiveSession: Hora extraída: ${appointmentTimeStr}`);
      
      // Criar data considerando o fuso horário
      const appointmentTime = createTimezoneSafeDate(appointmentDateStr, appointmentTimeStr);
      console.log(`⚠️ DEBUG isActiveSession: Data criada com createTimezoneSafeDate: ${appointmentTime.toISOString()}`);
      
      // Definir limite de 15 minutos antes e 30 minutos depois
      const earlyLimit = new Date(appointmentTime);
      earlyLimit.setMinutes(earlyLimit.getMinutes() - 15);
      
      const lateLimit = new Date(appointmentTime);
      lateLimit.setMinutes(lateLimit.getMinutes() + appointment.duration || 60);
      
      console.log(`⚠️ DEBUG isActiveSession: Janela de tempo - início: ${earlyLimit.toISOString()}, fim: ${lateLimit.toISOString()}`);
      console.log(`⚠️ DEBUG isActiveSession: Agora está entre limites? ${now >= earlyLimit && now <= lateLimit}`);
      console.log(`⚠️ DEBUG isActiveSession: Status do agendamento: ${appointment.status}`);
      
      return now >= earlyLimit && now <= lateLimit && appointment.status === 'scheduled';
    } catch (e) {
      console.error('Erro ao verificar se sessão está ativa:', e);
      return false;
    }
  };
  
  return (
    <div className={`bg-white rounded-lg shadow-md overflow-hidden border-l-4 ${
      appointment.appointmentType === 'client' ? 'border-l-green-500' : 'border-l-blue-500'
    }`}>
      <div className="p-4">
        <div className="flex justify-between items-start mb-3">
          <h3 className="font-medium text-lg text-gray-800">{personName || 'Nome não disponível'}</h3>
          
          <div className="flex gap-2">
            {/* Tipo de agendamento */}
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              appointment.appointmentType === 'client' 
                ? 'bg-green-100 text-green-800' 
                : 'bg-blue-100 text-blue-800'
            }`}>
              {appointment.appointmentType === 'client' ? 'Como Cliente' : 'Como Terapeuta'}
            </span>
            
            {/* Status do agendamento */}
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              appointment.status === 'scheduled' ? 'bg-blue-100 text-blue-800' :
              appointment.status === 'completed' ? 'bg-green-100 text-green-800' :
              appointment.status === 'cancelled' ? 'bg-red-100 text-red-800' : 
              'bg-gray-100 text-gray-800'
            }`}>
              {getStatusLabel(appointment.status)}
            </span>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <span className="text-sm text-gray-500">Data</span>
            <p className="text-gray-700">{formatDateTime(appointment.date)}</p>
          </div>
          
          <div>
            <span className="text-sm text-gray-500">Horário</span>
            <p className="text-gray-700">{formatDateTime(appointment.date, true)}</p>
          </div>
          
          <div>
            <span className="text-sm text-gray-500">Duração</span>
            <p className="text-gray-700">{appointment.duration || 50} minutos</p>
          </div>
          
          <div>
            <span className="text-sm text-gray-500">Modalidade</span>
            <p className="text-gray-700">{appointment.mode === 'ONLINE' ? 'Online' : 'Presencial'}</p>
          </div>
        </div>
        
        {/* Sessão experimental */}
        {appointment.isFreeSession && (
          <div className="mb-4">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
              Sessão Experimental
            </span>
          </div>
        )}
        
        {/* Ações */}
        <div className="flex flex-wrap gap-2 mt-4">
          {/* Botão Ver Detalhes */}
          <button
            onClick={handleViewDetails}
            className="flex-1 bg-gray-100 text-gray-800 py-2 px-4 rounded hover:bg-gray-200 text-sm font-medium transition-colors"
          >
            Ver Detalhes
          </button>
          
          {/* Botão para Entrar na Sessão (apenas se for online e ativa) */}
          {appointment.mode === 'ONLINE' && appointment.status === 'scheduled' && (
            <button
              onClick={handleJoinSession}
              disabled={!isActiveSession()}
              className={`flex-1 py-2 px-4 rounded text-sm font-medium transition-colors ${
                isActiveSession() 
                  ? 'bg-green-600 text-white hover:bg-green-700' 
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              Entrar na Sessão
            </button>
          )}
          
          {/* Opções de atualização de status para terapeutas */}
          {isTherapist && appointment.status === 'scheduled' && (
            <button
              onClick={() => onStatusUpdate(appointment.id, 'completed')}
              className="flex-1 bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 text-sm font-medium transition-colors"
            >
              Marcar como Concluída
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AppointmentCard; 