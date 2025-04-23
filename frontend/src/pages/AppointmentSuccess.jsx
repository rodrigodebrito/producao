import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheckCircle, faCalendarAlt, faUser, faClock, faVideo, faSpinner, faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import './AppointmentSuccess.css';
import api from '../services/api';
import { toast } from 'react-toastify';

const AppointmentSuccess = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const appointmentData = location.state?.appointmentData || {};
  const sessionData = location.state?.sessionData || null;
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  
  // Formatação de data
  const formatDate = (dateString) => {
    if (!dateString) return 'Data não informada';
    
    try {
      const [year, month, day] = dateString.split('-');
      return `${day}/${month}/${year}`;
    } catch (e) {
      return dateString;
    }
  };

  // Função para criar uma sessão para o agendamento
  const handleCreateSession = async () => {
    if (!appointmentData || !appointmentData.id) {
      toast.error('Não foi possível criar uma sala de sessão sem o ID do agendamento');
      return;
    }

    try {
      setIsCreatingSession(true);
      
      const response = await api.post('/api/sessions', {
        appointmentId: appointmentData.id,
        title: `Sessão com ${appointmentData.therapistName || 'Terapeuta'} - ${formatDate(appointmentData.date)}`,
        scheduledDuration: appointmentData.duration || 50
      });
      
      if (response.data && response.data.id) {
        toast.success('Sala de sessão criada com sucesso!');
        // Não redirecionar automaticamente para a sessão
        // Apenas atualizar a UI para mostrar informações sobre a sessão
        window.location.reload(); // Atualiza a página para mostrar os detalhes da sessão
      } else {
        throw new Error('Resposta inválida ao criar sessão');
      }
    } catch (error) {
      console.error('Erro ao criar sessão:', error);
      toast.error('Não foi possível criar a sala de sessão. Tente novamente mais tarde.');
    } finally {
      setIsCreatingSession(false);
    }
  };

  // Função para navegar para os detalhes da sessão (sem entrar na sala)
  const handleViewSessionDetails = () => {
    if (sessionData && sessionData.id) {
      navigate('/client/appointments', { state: { highlightSessionId: sessionData.id } });
    } else {
      navigate('/client/appointments');
    }
  };
  
  return (
    <div className="appointment-success-container">
      <div className="success-card">
        <div className="success-icon">
          <FontAwesomeIcon icon={faCheckCircle} size="4x" />
        </div>
        
        <h1>Agendamento Realizado com Sucesso!</h1>
        
        <p className="success-message">
          Seu agendamento foi registrado com sucesso. O terapeuta foi notificado e você receberá uma confirmação por e-mail.
        </p>
        
        <div className="appointment-details">
          <h2>Detalhes do Agendamento</h2>
          
          <div className="detail-item">
            <FontAwesomeIcon icon={faCalendarAlt} />
            <span className="label">Data:</span>
            <span className="value">{formatDate(appointmentData.date) || 'Data não informada'}</span>
          </div>
          
          <div className="detail-item">
            <FontAwesomeIcon icon={faClock} />
            <span className="label">Horário:</span>
            <span className="value">{appointmentData.time || 'Horário não informado'}</span>
          </div>
          
          <div className="detail-item">
            <FontAwesomeIcon icon={faUser} />
            <span className="label">Terapeuta:</span>
            <span className="value">{appointmentData.therapistName || 'Nome não informado'}</span>
          </div>
          
          <div className="detail-item">
            <FontAwesomeIcon icon={faClock} />
            <span className="label">Duração:</span>
            <span className="value">{appointmentData.duration || 50} minutos</span>
          </div>
        </div>
        
        {sessionData && sessionData.id && (
          <div className="session-info">
            <div className="session-info-header">
              <FontAwesomeIcon icon={faInfoCircle} />
              <h3>Informações sobre a Sessão</h3>
            </div>
            <p>
              Sua sessão está agendada para <strong>{formatDate(appointmentData.date)}</strong> às <strong>{appointmentData.time}</strong>.
            </p>
            <p>
              Você poderá acessar a sala de videoconferência a partir de 5 minutos antes do horário agendado.
            </p>
            <p>
              Para acessar a sala no momento da sessão, vá para a página "Meus Agendamentos" e clique em "Entrar na Sessão".
            </p>
          </div>
        )}
        
        <div className="action-buttons">
          {sessionData && sessionData.id ? (
            <button 
              className="primary-button" 
              onClick={handleViewSessionDetails}
            >
              <FontAwesomeIcon icon={faCalendarAlt} /> Ver Meus Agendamentos
            </button>
          ) : appointmentData.id && appointmentData.mode === 'ONLINE' ? (
            <button 
              className="session-button" 
              onClick={handleCreateSession}
              disabled={isCreatingSession}
            >
              {isCreatingSession ? (
                <>
                  <FontAwesomeIcon icon={faSpinner} spin /> Preparando Sala de Sessão...
                </>
              ) : (
                <>
                  <FontAwesomeIcon icon={faVideo} /> Criar Sala de Sessão
                </>
              )}
            </button>
          ) : null}
          
          <button 
            className="primary-button" 
            onClick={() => navigate('/client/appointments')}
          >
            Ver Meus Agendamentos
          </button>
          
          <button 
            className="secondary-button" 
            onClick={() => navigate('/')}
          >
            Voltar para Home
          </button>
        </div>
        
        <div className="info-note">
          <p>
            <strong>Importante:</strong> Em caso de necessidade de cancelamento, entre em contato com o terapeuta 
            com pelo menos 24 horas de antecedência.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AppointmentSuccess; 