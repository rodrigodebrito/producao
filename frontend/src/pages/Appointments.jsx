import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getAppointments, cancelAppointment, syncPendingCancellations } from '../services/appointmentService';
import './ClientAppointments.css';
import { toast } from 'react-hot-toast';
import api from '../services/api';
import { format } from 'date-fns';
import { createRobustSession } from '../services/sessionService';

// Função auxiliar para validar se uma data é futura
const isValidFutureDate = (date, time) => {
  const now = new Date();
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  const appointmentDate = new Date(year, month - 1, day, hours, minutes);
  
  // Retorna true se a data/hora é futura
  return appointmentDate > now;
};

function Appointments() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('upcoming');
  const [filter, setFilter] = useState('all'); // 'all', 'asClient', 'asTherapist'
  const [historyFilter, setHistoryFilter] = useState('all'); // 'all', 'cancelled', 'completed'
  const [searchTerm, setSearchTerm] = useState('');
  const location = useLocation();
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchAppointments = async () => {
      try {
        setLoading(true);
        
        // Tentar sincronizar cancelamentos pendentes
        try {
          console.log('Tentando sincronizar cancelamentos pendentes...');
          const syncResult = await syncPendingCancellations();
          
          // Notificar apenas se houver sucesso real ou limpeza
          if (syncResult.synced > 0) {
            toast.success(`${syncResult.synced} agendamento(s) cancelado(s) foram sincronizados com sucesso!`);
          }
          
          // Notificar sobre limpeza apenas se não houve sucessos
          if (syncResult.synced === 0 && syncResult.cleaned > 0) {
            toast.info(`${syncResult.cleaned} agendamento(s) antigo(s) foram removidos da fila por não poderem ser sincronizados.`);
          }
          
        } catch (syncError) {
          console.error('Erro ao sincronizar cancelamentos pendentes:', syncError);
        }
        
        // Buscar todos os agendamentos do usuário atual
        const data = await getAppointments();
        console.log('Agendamentos recebidos:', data);
        
        // Verificar se há cancelamentos pendentes no localStorage
        try {
          const pendingCancellations = JSON.parse(localStorage.getItem('pendingCancellations') || '[]');
          
          // Marcar agendamentos com cancelamento pendente
          if (pendingCancellations.length > 0) {
            const updatedData = data.map(appointment => {
              const pendingCancel = pendingCancellations.find(pc => pc.id === appointment.id);
              if (pendingCancel) {
                return {
                  ...appointment,
                  status: 'CANCELLED',
                  _localCancellation: true,
                  cancellationSynced: false
                };
              }
              return appointment;
            });
            
            setAppointments(updatedData);
          } else {
            setAppointments(data);
          }
        } catch (localStorageError) {
          console.error('Erro ao processar cancelamentos pendentes do localStorage:', localStorageError);
          setAppointments(data);
        }
        
        setError(null);
      } catch (err) {
        console.error('Erro ao buscar agendamentos:', err);
        setError('Erro ao carregar agendamentos. Por favor, tente novamente.');
      } finally {
        setLoading(false);
      }
    };

    fetchAppointments();
  }, [user, location.state?.newAppointment]);

  const filterAppointments = (appointments) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Primeiro, filtrar por tipo de agendamento
    let filtered = appointments;
    if (filter !== 'all') {
      filtered = appointments.filter(app => 
        filter === 'asClient' ? app.appointmentType === 'client' : app.appointmentType === 'therapist'
      );
    }

    // Depois, filtrar por nome se houver busca
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(app => {
        const name = app.appointmentType === 'client' 
          ? app.therapistName?.toLowerCase() 
          : app.clientName?.toLowerCase();
        return name?.includes(term);
      });
    }

    // Por fim, filtrar por status/data
    return filtered.filter(appointment => {
      const appointmentDate = new Date(appointment.date);
      appointmentDate.setHours(0, 0, 0, 0);

      if (activeTab === 'upcoming') {
        return appointmentDate >= today && appointment.status === 'SCHEDULED';
      } else {
        // Filtros do histórico
        const isHistory = appointmentDate < today || 
                         appointment.status === 'CANCELLED' || 
                         appointment.status === 'COMPLETED';

        if (!isHistory) return false;

        switch (historyFilter) {
          case 'cancelled':
            return appointment.status === 'CANCELLED';
          case 'completed':
            return appointment.status === 'COMPLETED';
          default:
            return true;
        }
      }
    });
  };

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
      // Primeiro, verificar se já existe uma sessão para este agendamento
      let session;
      
      // Buscar todas as sessões do usuário
      const sessionsResponse = await api.get('/sessions');
      const sessions = sessionsResponse.data;
      
      // Verificar se alguma sessão já está associada a este agendamento
      const existingSession = sessions.find(s => s.appointmentId === appointment.id);
      
      if (existingSession) {
        session = existingSession;
      } else {
        // Se não existir sessão, criar uma nova
        session = await createRobustSession(appointment);
      }
      
      if (!session || !session.id) {
        throw new Error('Não foi possível criar ou encontrar a sessão');
      }
      
      // Navegar para a sala de sessão
      toast.success('Entrando na sala de sessão...');
      navigate(`/session/${session.id}`);
    } catch (error) {
      toast.error('Não foi possível acessar a sala de sessão. Tente novamente.');
    }
  };

  const handleViewTherapist = (therapistId) => {
    if (!therapistId) {
      toast.error('ID do terapeuta não disponível');
      return;
    }
    navigate(`/therapist/${therapistId}`);
  };

  if (loading) {
    return <div className="loading">Carregando suas sessões...</div>;
  }

  const filteredAppointments = filterAppointments(appointments);

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
                    <strong>Data:</strong> {new Date(appointment.date).toLocaleDateString('pt-BR')}
                  </p>
                  <p>
                    <strong>Horário:</strong> {new Date(appointment.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
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