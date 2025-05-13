import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getAppointments, cancelAppointment, syncPendingCancellations } from '../services/appointmentService';
import { isValidFutureDate, createTimezoneSafeDate } from '../utils/dateUtils';
import './ClientAppointments.css';
import toast from 'react-hot-toast';
import api from '../services/api';
import { format, parseISO } from 'date-fns';
import { createRobustSession } from '../services/sessionService';

function Appointments() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('upcoming');
  const [filter, setFilter] = useState('all');
  const [historyFilter, setHistoryFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const location = useLocation();
  const [error, setError] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [filterName, setFilterName] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  useEffect(() => {
    console.log('useEffect em Appointments.jsx acionado');
    console.log('Estado de localização:', location);
    
    const fetchAppointments = async () => {
      try {
        setLoading(true);
        console.log('Buscando agendamentos...');
        
        const fetchedAppointments = await getAppointments();
        console.log(`Total de agendamentos recebidos: ${fetchedAppointments.length}`);
        
        // Processar cancelamentos pendentes do localStorage
        try {
          const pendingCancellations = JSON.parse(localStorage.getItem('pendingCancellations')) || [];
          console.log('Cancelamentos pendentes:', pendingCancellations);
          
          if (pendingCancellations.length > 0) {
            const updatedAppointments = fetchedAppointments.map(appointment => {
              const isPendingCancellation = pendingCancellations.includes(appointment.id);
              if (isPendingCancellation) {
                console.log(`Marcando agendamento ${appointment.id} como pendente de cancelamento`);
                return { ...appointment, pendingCancellation: true };
              }
              return appointment;
            });
            
            setAppointments(updatedAppointments);
          } else {
            setAppointments(fetchedAppointments);
          }
        } catch (error) {
          console.error('Erro ao processar cancelamentos pendentes:', error);
          setAppointments(fetchedAppointments);
        }
        
        setLoading(false);
        console.log('Agendamentos carregados com sucesso');
      } catch (error) {
        console.error('Erro ao buscar agendamentos:', error);
        toast.error(error.message || 'Erro ao carregar agendamentos');
        setLoading(false);
        setError(error.message || 'Erro ao carregar agendamentos');
      }
    };

    fetchAppointments();
  }, [location.key]); // Usar location.key para atualizar quando a navegação mudar

  // Função para filtrar agendamentos com base nos critérios
  const filterAppointments = () => {
    console.log('Filtrando agendamentos...');
    console.log('Critérios:', { activeTab, historyFilter, filterType, filterName, filterStatus, searchTerm });
    console.log('Total de agendamentos antes do filtro:', appointments.length);
    
    if (!appointments || !Array.isArray(appointments)) {
      console.warn('Nenhum agendamento disponível para filtrar');
      return [];
    }

    return appointments.filter(appointment => {
      // Log inicial para cada agendamento
      console.log(`Verificando agendamento ID: ${appointment.id}, Tipo: ${appointment.appointmentType}, Status: ${appointment.status}`);
      
      // Garantir que temos uma data válida para comparar - NOVO MÉTODO CORRIGIDO
      let appointmentDate;
      try {
        // Verificar se temos originalDay ou originalDate no agendamento
        let selectedDay = null;
        if (appointment.originalDay) {
          selectedDay = parseInt(appointment.originalDay, 10);
          console.log(`🔄 Usando dia original do agendamento: ${selectedDay}`);
        } else if (appointment.notes && appointment.notes.includes('TZ_INFO:')) {
          // Tentar extrair informações de timezone das notas
          try {
            const tzInfoMatch = appointment.notes.match(/TZ_INFO:({.*})/) || [];
            if (tzInfoMatch.length > 1) {
              const tzInfo = JSON.parse(tzInfoMatch[1]);
              if (tzInfo.originalDay) {
                selectedDay = parseInt(tzInfo.originalDay, 10);
                console.log(`🔄 Dia original extraído das notas: ${selectedDay}`);
              }
            }
          } catch (e) {
            console.warn('Erro ao extrair info de timezone das notas:', e);
          }
        }
        
        // Criar a data do agendamento
        appointmentDate = new Date(appointment.date);
        
        // Se temos o dia original e ele é diferente, corrigir
        if (selectedDay !== null && appointmentDate.getDate() !== selectedDay) {
          console.log(`🔄 Corrigindo dia de ${appointmentDate.getDate()} para ${selectedDay}`);
          const correctedDate = new Date(appointmentDate);
          correctedDate.setDate(selectedDay);
          appointmentDate = correctedDate;
        }
        
        if (isNaN(appointmentDate.getTime())) {
          console.warn(`Agendamento ${appointment.id} possui data inválida:`, appointment.date);
          appointmentDate = new Date(); // Usar data atual como fallback
        }
        appointmentDate.setHours(0, 0, 0, 0);
        console.log(`Data final do agendamento para comparação: ${appointmentDate.toISOString()}`);
      } catch (error) {
        console.error(`Erro ao processar data do agendamento ${appointment.id}:`, error);
        appointmentDate = new Date(); // Usar data atual como fallback
        appointmentDate.setHours(0, 0, 0, 0);
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Filtro por abas (upcoming/history)
      if (activeTab === 'upcoming') {
        // Para aba de próximos, mostrar agendamentos futuros com status SCHEDULED ou CONFIRMED
        if (!(appointmentDate >= today && 
            (appointment.status === 'SCHEDULED' || appointment.status === 'CONFIRMED'))) {
          console.log(`🚫 Filtrado (não é próximo): ${appointment.id}`);
          return false;
        }
      } else if (activeTab === 'history') {
        // Para histórico, mostrar agendamentos passados OU cancelados/completados
        const isHistory = appointmentDate < today || 
                        appointment.status === 'CANCELLED' || 
                        appointment.status === 'COMPLETED';

        if (!isHistory) {
          console.log(`🚫 Filtrado (não é histórico): ${appointment.id}`);
          return false;
        }

        // Filtro adicional por status específico no histórico
        if (historyFilter !== 'all') {
          if (historyFilter === 'cancelled' && appointment.status !== 'CANCELLED') {
            console.log(`🚫 Filtrado (não cancelado): ${appointment.id}`);
            return false;
          }
          if (historyFilter === 'completed' && appointment.status !== 'COMPLETED') {
            console.log(`🚫 Filtrado (não completado): ${appointment.id}`);
            return false;
          }
        }
      }
      
      // Filtro por tipo de agendamento
      if (filter !== 'all') {
        const isAsClient = filter === 'asClient';
        const typeMatches = isAsClient ? 
          appointment.appointmentType === 'client' : 
          appointment.appointmentType === 'therapist';
        
        if (!typeMatches) {
          console.log(`🚫 Filtrado (tipo não corresponde): ${appointment.id}`);
          return false;
        }
      }

      // Filtro por nome do terapeuta/cliente (usando searchTerm)
      if (searchTerm && searchTerm.trim() !== '') {
        const term = searchTerm.toLowerCase();
        const nameToCheck = appointment.appointmentType === 'client' 
          ? (appointment.therapist?.name || appointment.therapistName)
          : (appointment.client?.name || appointment.clientName);
          
        const nameMatches = nameToCheck && nameToCheck.toLowerCase().includes(term);
        if (!nameMatches) {
          console.log(`🚫 Filtrado (nome não corresponde): ${appointment.id}`);
          return false;
        }
      }
      
      console.log(`✅ Passou por todos os filtros: ${appointment.id}`);
      return true;
    });
  };

  // Aplicar filtros
  const filteredAppointments = filterAppointments();
  console.log(`Total de agendamentos após filtro: ${filteredAppointments.length}`);

  const handleCancelAppointment = async (appointmentId) => {
    try {
      await cancelAppointment(appointmentId);
      const updatedAppointments = appointments.map(app => 
        app.id === appointmentId ? { ...app, status: 'CANCELLED' } : app
      );
      setAppointments(updatedAppointments);
    } catch (err) {
      console.error('Erro ao cancelar agendamento:', err);
      setError('Erro ao cancelar agendamento. Por favor, tente novamente.');
    }
  };

  const handleScheduleNew = () => {
    navigate('/directory');
  };

  const handleJoinSession = async (appointment) => {
    try {
      // Verificar se o horário atual é compatível com o horário agendado
      const now = new Date();
      
      console.log('🔄 Preparando para entrar na sessão do agendamento:', appointment);
      
      // NOVA LÓGICA: Usar formattedDate e formattedTime com prioridade se disponíveis
      let appointmentTime;
      
      if (appointment.formattedDate && appointment.formattedTime) {
        // Usar formattedDate e formattedTime que estão com o dia correto
        console.log(`🕒 Usando formattedDate (${appointment.formattedDate}) e formattedTime (${appointment.formattedTime})`);
        
        // Converter formato DD/MM/YYYY para YYYY-MM-DD
        const [day, month, year] = appointment.formattedDate.split('/').map(Number);
        const [hours, minutes] = appointment.formattedTime.split(':').map(Number);
        
        console.log(`📊 Componentes extraídos: dia=${day}, mês=${month}, ano=${year}, hora=${hours}, minuto=${minutes}`);
        
        // Criar objeto Date usando componentes
        appointmentTime = new Date(year, month - 1, day, hours, minutes);
        console.log(`📅 Data criada: ${appointmentTime.toString()}`);
      } else {
        // Fallback para o método antigo
        console.log('⚠️ Usando método antigo para extrair data e hora');
        
        // Extrair a data e hora do agendamento
        const appointmentDateStr = appointment.date.split('T')[0];
        const appointmentTimeStr = format(parseISO(appointment.date), 'HH:mm');
        
        // Criar data considerando o fuso horário
        appointmentTime = createTimezoneSafeDate(appointmentDateStr, appointmentTimeStr);
      }
      
      console.log(`⏰ Horário final da sessão: ${appointmentTime.toLocaleString()}`);
      const appointmentEndTime = new Date(appointmentTime.getTime() + (appointment.duration * 60000));
      
      // Permitir acesso 24 horas (1440 minutos) antes do horário agendado (para teste)
      const earlyAccessTime = new Date(appointmentTime.getTime() - 1440 * 60000);
      
      console.log(`🔄 Verificando acesso:
        - Horário atual: ${now.toLocaleString()}
        - Horário do agendamento: ${appointmentTime.toLocaleString()}
        - Acesso liberado a partir de: ${earlyAccessTime.toLocaleString()}
        - Sessão termina às: ${appointmentEndTime.toLocaleString()}
      `);
      
      // Se o usuário estiver tentando acessar fora do horário permitido
      if (now < earlyAccessTime) {
        // Calcular minutos até poder acessar a sala
        const minutesUntilEarlyAccess = Math.ceil((earlyAccessTime - now) / 60000);
        
        console.log(`⏱️ Cálculo de tempo: 
          - Tempo atual: ${now.getTime()}
          - Tempo de acesso liberado: ${earlyAccessTime.getTime()}
          - Diferença em ms: ${earlyAccessTime - now}
          - Diferença em minutos: ${minutesUntilEarlyAccess}
        `);
        
        // Limitar a exibição a um valor razoável (máximo 24 horas = 1440 minutos)
        const displayMinutes = Math.min(minutesUntilEarlyAccess, 1440);
        
        // Formatar a hora de acesso liberado de forma amigável
        const earlyAccessHour = earlyAccessTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const earlyAccessDate = earlyAccessTime.toLocaleDateString('pt-BR');
        
        toast(`Sua sessão está agendada para ${appointment.formattedTime}.
        O acesso será liberado a partir de ${earlyAccessDate} às ${earlyAccessHour} (24 horas antes).
        Faltam ${displayMinutes} minutos para você poder acessar a sala.`, {
          duration: 5000,
        });
        return;
      }
      
      if (now > appointmentEndTime) {
        toast('Esta sessão já foi encerrada. Não é mais possível acessar a sala.');
        return;
      }
      
      // Se o status não for confirmado, impedir acesso
      if (appointment.status !== 'CONFIRMED' && appointment.status !== 'SCHEDULED') {
        toast.error('Não é possível acessar a sala: o agendamento não está confirmado');
        return;
      }
      
      // Verificar se já existe uma sessão para este agendamento
      const response = await api.get(`/api/sessions/appointment/${appointment.id}`);
      let session = null;
      let existingSession = null;
      
      if (response.data && response.data.id) {
        existingSession = response.data;
      }
      
      if (existingSession) {
        session = existingSession;
      } else {
        // Se não existir sessão, criar uma nova
        session = await createRobustSession(appointment);
      }
      
      if (!session || !session.id) {
        throw new Error('Não foi possível criar ou encontrar a sessão');
      }
      
      // Agora que todas as verificações foram realizadas e o horário é válido, 
      // podemos navegar para a sala de sessão
      toast.success('Entrando na sala de sessão...');
      navigate(`/session/${session.id}`);
    } catch (error) {
      console.error('Erro ao acessar sessão:', error);
      toast('Não foi possível acessar a sala de sessão. Tente novamente.');
    }
  };

  const handleViewTherapist = (therapistId) => {
    if (!therapistId) {
      toast('ID do terapeuta não disponível');
      return;
    }
    navigate(`/therapist/${therapistId}`);
  };

  if (loading) {
    return <div className="loading">Carregando suas sessões...</div>;
  }

  return (
    <div className="client-appointments-container">
      <div className="appointments-header">
        <h1>Minha Agenda</h1>
        <button 
          className="schedule-new-button"
          onClick={handleScheduleNew}
        >
          Agendar Nova Sessão
        </button>
      </div>

      <div className="filters-container">
        <div className="filter-group">
          <label>Filtrar por:</label>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Todas as Consultas</option>
            <option value="asClient">Consultas como Cliente</option>
            {user.role === 'THERAPIST' && (
              <option value="asTherapist">Consultas como Terapeuta</option>
            )}
          </select>
        </div>

        <div className="search-group">
          <input
            type="text"
            placeholder="Buscar por nome..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="appointments-tabs">
        <button 
          className={`tab-button ${activeTab === 'upcoming' ? 'active' : ''}`}
          onClick={() => setActiveTab('upcoming')}
        >
          Próximas Sessões
        </button>
        <button 
          className={`tab-button ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          Histórico
        </button>
      </div>

      {activeTab === 'history' && (
        <div className="history-filters">
          <button 
            className={`filter-button ${historyFilter === 'all' ? 'active' : ''}`}
            onClick={() => setHistoryFilter('all')}
          >
            Todas
          </button>
          <button 
            className={`filter-button ${historyFilter === 'completed' ? 'active' : ''}`}
            onClick={() => setHistoryFilter('completed')}
          >
            Concluídas
          </button>
          <button 
            className={`filter-button ${historyFilter === 'cancelled' ? 'active' : ''}`}
            onClick={() => setHistoryFilter('cancelled')}
          >
            Canceladas
          </button>
        </div>
      )}

      <div className="appointments-list">
        {filteredAppointments.length === 0 ? (
          <div className="no-appointments">
            <p>
              {activeTab === 'upcoming' 
                ? 'Nenhuma sessão agendada.'
                : 'Nenhuma sessão no histórico.'}
            </p>
            <button 
              className="schedule-button"
              onClick={handleScheduleNew}
            >
              Agendar uma sessão
            </button>
          </div>
        ) : (
          filteredAppointments.map(appointment => (
            <div 
              key={appointment.id} 
              className={`appointment-card ${appointment.appointmentType === 'client' ? 'as-client' : 'as-therapist'}`}
            >
              <div className="appointment-main-info">
                <div className="appointment-header">
                  <h3>
                    {appointment.appointmentType === 'client' 
                      ? appointment.therapistName 
                      : appointment.clientName}
                  </h3>
                  <div className="appointment-badges">
                    <span className={`appointment-type-badge ${appointment.appointmentType}`}>
                      {appointment.appointmentType === 'client' ? 'Como Cliente' : 'Como Terapeuta'}
                    </span>
                    <span className={`appointment-status ${appointment.status.toLowerCase()} ${appointment._localCancellation ? 'local-only' : ''}`}>
                      {appointment.status === 'SCHEDULED' ? 'Agendada' :
                       appointment.status === 'COMPLETED' ? 'Realizada' : 
                       appointment._localCancellation ? 'Cancelada (pendente)' : 'Cancelada'}
                    </span>
                    {appointment._localCancellation && (
                      <span className="sync-pending-badge" title="Este cancelamento ainda não foi sincronizado com o servidor">
                        ⚠️ Pendente
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="appointment-details">
                  <p>
                    <strong>Data:</strong> {appointment.formattedDate || new Date(appointment.date).toLocaleDateString('pt-BR')}
                  </p>
                  <p>
                    <strong>Horário:</strong> {appointment.formattedTime || new Date(appointment.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <p>
                    <strong>Duração:</strong> {appointment.duration} minutos
                  </p>
                  <p>
                    <strong>Modalidade:</strong> {appointment.mode === 'ONLINE' ? 'Online' : 'Presencial'}
                  </p>
                  {appointment.isFreeSession && (
                    <span className="free-session-badge">Sessão Experimental</span>
                  )}
                </div>
              </div>

              <div className="appointment-actions">
                {appointment.status === 'SCHEDULED' && (
                  <>
                    <button 
                      onClick={() => handleCancelAppointment(appointment.id)} 
                      className="cancel-btn"
                    >
                      Cancelar
                    </button>
                    
                    {/* Botão para entrar na sala de sessão */}
                    {appointment.mode === 'ONLINE' && (
                      <button 
                        onClick={() => handleJoinSession(appointment)} 
                        className="join-session-btn"
                      >
                        Entrar na Sessão
                      </button>
                    )}
                  </>
                )}
                
                <button 
                  onClick={() => handleViewTherapist(appointment.therapistId)} 
                  className="view-therapist-btn"
                >
                  Ver Terapeuta
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default Appointments; 