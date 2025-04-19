import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import { createTestSession } from '../services/sessionService';
import './TherapistDashboard.css';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import Button from '../components/Button';

const TherapistDashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  
  const [therapistData, setTherapistData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  useEffect(() => {
    const fetchTherapistData = async () => {
      try {
        if (user?.id) {
          const response = await api.get(`/therapists/user/${user.id}`);
          setTherapistData(response.data);
        }
      } catch (err) {
        console.error('Erro ao buscar dados do terapeuta:', err);
        setError('Não foi possível carregar seus dados. Por favor, tente novamente.');
      } finally {
        setLoading(false);
      }
    };
    
    fetchTherapistData();
  }, [user]);
  
  const handleUpdateProfile = () => {
    navigate('/therapist/profile');
  };
  
  const handleManageSchedule = () => {
    navigate('/therapist/schedule');
  };
  
  const handleSetAvailability = () => {
    navigate('/therapist/availability');
  };
  
  const handleSetAvailabilitySimple = () => {
    navigate('/therapist/availability-simple');
  };
  
  const handleViewAppointments = () => {
    navigate('/therapist/appointments');
  };
  
  const handleCreateTestSession = async () => {
    try {
      toast.loading('Criando sessão de teste...');
      const session = await createTestSession();
      
      if (!session || !session.id) {
        throw new Error('Sessão criada sem ID válido');
      }
      
      toast.dismiss();
      toast.success('Sessão de teste criada com sucesso!');
      navigate(`/session/${session.id}`);
    } catch (error) {
      toast.dismiss();
      console.error('Erro ao criar sessão de teste:', error);
      
      // Verificar tipos específicos de erro
      if (error.response) {
        // Erro de resposta da API
        if (error.response.status === 404) {
          toast.error('Endpoint de sessão de teste não encontrado. Verifique se o servidor está atualizado.');
        } else if (error.response.status === 403) {
          toast.error('Não autorizado. Apenas terapeutas podem criar sessões de teste.');
        } else {
          toast.error(`Erro do servidor: ${error.response.data?.message || 'Erro desconhecido'}`);
        }
      } else if (error.request) {
        // Erro de rede - sem resposta
        toast.error('Erro de conexão. Verifique se o servidor está disponível.');
      } else {
        // Erro desconhecido
        toast.error('Não foi possível criar a sessão de teste. Tente novamente.');
      }
    }
  };
  
  // Verificar se perfil está completo
  const isProfileComplete = () => {
    if (!therapistData) return false;
    
    return !!(
      therapistData.bio && 
      therapistData.specialties && 
      therapistData.education && 
      therapistData.sessionPrice
    );
  };

  return (
    <div className="therapist-dashboard-container">
      <header className="dashboard-header">
        <h1>Meu Dashboard</h1>
        <div className="user-info">
          <span>Olá, {user?.name}</span>
          <Button 
            onClick={logout} 
            variant="danger" 
            size="small"
            className="btn-icon"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 512 512" style={{marginRight: '8px'}}>
              <path d="M377.9 105.9L500.7 228.7c7.2 7.2 11.3 17.1 11.3 27.3s-4.1 20.1-11.3 27.3L377.9 406.1c-6.4 6.4-15 9.9-24 9.9c-18.7 0-33.9-15.2-33.9-33.9l0-62.1-128 0c-17.7 0-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32l128 0 0-62.1c0-18.7 15.2-33.9 33.9-33.9c9 0 17.6 3.6 24 9.9zM160 96L96 96c-17.7 0-32 14.3-32 32l0 256c0 17.7 14.3 32 32 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-64 0c-53 0-96-43-96-96L0 128C0 75 43 32 96 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32z"/>
            </svg>
            Sair
          </Button>
        </div>
      </header>

      <main className="dashboard-content">
        {loading ? (
          <div className="loading-indicator">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 512 512" fill="currentColor" style={{animation: 'spin 2s linear infinite'}}>
              <path d="M304 48a48 48 0 1 0 -96 0 48 48 0 1 0 96 0zm0 416a48 48 0 1 0 -96 0 48 48 0 1 0 96 0zM48 304a48 48 0 1 0 0-96 48 48 0 1 0 0 96zm464-48a48 48 0 1 0 -96 0 48 48 0 1 0 96 0zM142.9 437A48 48 0 1 0 75 369.1 48 48 0 1 0 142.9 437zm0-294.2A48 48 0 1 0 75 75a48 48 0 1 0 67.9 67.9zM369.1 437A48 48 0 1 0 437 369.1 48 48 0 1 0 369.1 437z"/>
            </svg>
            <span>Carregando...</span>
          </div>
        ) : error ? (
          <div className="error-message">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 512 512" fill="#e74c3c">
              <path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm0-384c13.3 0 24 10.7 24 24V264c0 13.3-10.7 24-24 24s-24-10.7-24-24V152c0-13.3 10.7-24 24-24zM224 352a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z"/>
            </svg>
            <p>{error}</p>
          </div>
        ) : (
          <>
            {!isProfileComplete() && (
              <div className="alert-message">
                <div className="alert-header">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 512 512" fill="var(--gold)">
                    <path d="M256 32c14.2 0 27.3 7.5 34.5 19.8l216 368c7.3 12.4 7.3 27.7 .2 40.1S486.3 480 472 480H40c-14.3 0-27.6-7.7-34.7-20.1s-7-27.8 .2-40.1l216-368C228.7 39.5 241.8 32 256 32zm0 128c-13.3 0-24 10.7-24 24V296c0 13.3 10.7 24 24 24s24-10.7 24-24V184c0-13.3-10.7-24-24-24zm32 224a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z"/>
                  </svg>
                  <strong>Seu perfil está incompleto!</strong>
                </div>
                <p>Complete seu perfil para aumentar suas chances de conseguir clientes.</p>
                <Button 
                  onClick={handleUpdateProfile} 
                  variant="warning"
                  className="btn-icon"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 512 512" style={{marginRight: '8px'}}>
                    <path d="M362.7 19.3L314.3 67.7 444.3 197.7l48.4-48.4c25-25 25-65.5 0-90.5L453.3 19.3c-25-25-65.5-25-90.5 0zm-71 71L58.6 323.5c-10.4 10.4-18 23.3-22.2 37.4L1 481.2C-1.5 489.7 .8 498.8 7 505s15.3 8.5 23.7 6.1l120.3-35.4c14.1-4.2 27-11.8 37.4-22.2L421.7 220.3 291.7 90.3z"/>
                  </svg>
                  Completar Perfil
                </Button>
              </div>
            )}
            
            <section className="welcome-section">
              <div className="welcome-content">
                <h2>Bem-vindo(a) à sua área de terapeuta</h2>
                <p>Gerencie seus agendamentos, disponibilidade e perfil profissional.</p>
              </div>
              <div className="welcome-illustration">
                <img src="/images/dashboard-welcome.svg" alt="Bem-vindo" />
              </div>
            </section>

            <div className="dashboard-grid">
              <section className="upcoming-appointments card">
                <div className="card-header">
                  <h3>
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 448 512" fill="white" style={{marginRight: '10px'}}>
                      <path d="M152 24c0-13.3-10.7-24-24-24s-24 10.7-24 24V64H64C28.7 64 0 92.7 0 128v320c0 35.3 28.7 64 64 64H384c35.3 0 64-28.7 64-64V128c0-35.3-28.7-64-64-64H344V24c0-13.3-10.7-24-24-24s-24 10.7-24 24V64H152V24zM48 448V192H400V448c0 8.8-7.2 16-16 16H64c-8.8 0-16-7.2-16-16z"/>
                    </svg>
                    Próximos Agendamentos
                  </h3>
                </div>
                <div className="card-body">
                  <div className="placeholder-content">
                    <p>Nenhum agendamento próximo no momento.</p>
                    <Button 
                      onClick={handleViewAppointments} 
                      variant="primary"
                      className="btn-icon"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 512 512" style={{marginRight: '8px'}}>
                        <path d="M64 144a48 48 0 1 0 0-96 48 48 0 1 0 0 96zM192 64c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zM64 464a48 48 0 1 0 0-96 48 48 0 1 0 0 96zm48-208a48 48 0 1 0 -96 0 48 48 0 1 0 96 0z"/>
                      </svg>
                      Ver Agenda Completa
                    </Button>
                  </div>
                </div>
              </section>

              <section className="quick-actions card">
                <div className="card-header">
                  <h3>
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 384 512" fill="white" style={{marginRight: '10px'}}>
                      <path d="M0 256L28.5 28c2-16 15.6-28 31.8-28H228.9c15 0 28.2 10.9 30.8 25.5l30.9 174.4c2.3 12.8-1.6 26-10.6 35.4L224 288H328c13.3 0 24 10.7 24 24s-10.7 24-24 24H248L337.3 473c7.7 11.6 4.6 27.2-7 34.9s-27.2 4.6-34.9-7L192 351.9 87.8 501.6c-7.8 11.3-23.3 14.1-34.6 6.3s-14.1-23.3-6.3-34.6L132.5 336H56c-13.3 0-24-10.7-24-24s10.7-24 24-24h120L134 198.5c-8.6-10.1-11.6-24-8-36.8L0 256z"/>
                    </svg>
                    Ações Rápidas
                  </h3>
                </div>
                <div className="card-body">
                  <div className="action-buttons">
                    <Button 
                      onClick={handleManageSchedule} 
                      variant="secondary"
                      className="btn-icon action-button"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 448 512" style={{marginRight: '8px'}}>
                        <path d="M152 24c0-13.3-10.7-24-24-24s-24 10.7-24 24V64H64C28.7 64 0 92.7 0 128v320c0 35.3 28.7 64 64 64H384c35.3 0 64-28.7 64-64V128c0-35.3-28.7-64-64-64H344V24c0-13.3-10.7-24-24-24s-24 10.7-24 24V64H152V24zM48 448V192H400V448c0 8.8-7.2 16-16 16H64c-8.8 0-16-7.2-16-16z"/>
                      </svg>
                      Gerenciar Agenda
                    </Button>
                    <Button 
                      onClick={handleUpdateProfile} 
                      variant="secondary"
                      className="btn-icon action-button"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 448 512" style={{marginRight: '8px'}}>
                        <path d="M224 256A128 128 0 1 0 224 0a128 128 0 1 0 0 256zm-45.7 48C79.8 304 0 383.8 0 482.3C0 498.7 13.3 512 29.7 512H418.3c16.4 0 29.7-13.3 29.7-29.7C448 383.8 368.2 304 269.7 304H178.3z"/>
                      </svg>
                      Atualizar Perfil
                    </Button>
                    <Button 
                      onClick={handleSetAvailability} 
                      variant="secondary"
                      className="btn-icon action-button"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 512 512" style={{marginRight: '8px'}}>
                        <path d="M256 0a256 256 0 1 1 0 512A256 256 0 1 1 256 0zM232 120V256c0 8 4 15.5 10.7 20l96 64c11 7.4 25.9 4.4 33.3-6.7s4.4-25.9-6.7-33.3L280 243.2V120c0-13.3-10.7-24-24-24s-24 10.7-24 24z"/>
                      </svg>
                      Definir Horários Disponíveis
                    </Button>
                  </div>
                </div>
              </section>

              <section className="statistics card">
                <div className="card-header">
                  <h3>
                    <i className="fas fa-chart-bar"></i>
                    Estatísticas
                  </h3>
                </div>
                <div className="card-body">
                  <div className="stats-grid">
                    <div className="stat-card">
                      <h4>0</h4>
                      <p>Sessões Este Mês</p>
                      <i className="fas fa-video"></i>
                    </div>
                    <div className="stat-card">
                      <h4>0</h4>
                      <p>Clientes Ativos</p>
                      <i className="fas fa-users"></i>
                    </div>
                    <div className="stat-card">
                      <h4>0%</h4>
                      <p>Taxa de Ocupação</p>
                      <i className="fas fa-percentage"></i>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {/* Seção de cards de ações */}
            <h3 className="section-title">
              <i className="fas fa-th-large"></i>
              Gestão de Serviços
            </h3>
            <div className="dashboard-cards">
              <div className="dashboard-card" onClick={handleUpdateProfile}>
                <div className="card-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 448 512" fill="white">
                    <path d="M224 256A128 128 0 1 0 224 0a128 128 0 1 0 0 256zm-45.7 48C79.8 304 0 383.8 0 482.3C0 498.7 13.3 512 29.7 512H418.3c16.4 0 29.7-13.3 29.7-29.7C448 383.8 368.2 304 269.7 304H178.3z"/>
                  </svg>
                </div>
                <h3>Perfil Profissional</h3>
                <p>Edite seu perfil e configure seus serviços</p>
              </div>
              
              <div className="dashboard-card" onClick={handleSetAvailability}>
                <div className="card-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 512 512" fill="white">
                    <path d="M256 0a256 256 0 1 1 0 512A256 256 0 1 1 256 0zM232 120V256c0 8 4 15.5 10.7 20l96 64c11 7.4 25.9 4.4 33.3-6.7s4.4-25.9-6.7-33.3L280 243.2V120c0-13.3-10.7-24-24-24s-24 10.7-24 24z"/>
                  </svg>
                </div>
                <h3>Minha Disponibilidade</h3>
                <p>Configure os horários que você está disponível</p>
              </div>
              
              <div className="dashboard-card" onClick={handleManageSchedule}>
                <div className="card-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 448 512" fill="white">
                    <path d="M152 24c0-13.3-10.7-24-24-24s-24 10.7-24 24V64H64C28.7 64 0 92.7 0 128v320c0 35.3 28.7 64 64 64H384c35.3 0 64-28.7 64-64V128c0-35.3-28.7-64-64-64H344V24c0-13.3-10.7-24-24-24s-24 10.7-24 24V64H152V24zM48 448V192H400V448c0 8.8-7.2 16-16 16H64c-8.8 0-16-7.2-16-16z"/>
                  </svg>
                </div>
                <h3>Agenda</h3>
                <p>Visualize e gerencie seus agendamentos</p>
              </div>
              
              <div className="dashboard-card" onClick={() => navigate('/directory')}>
                <div className="card-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 512 512" fill="white">
                    <path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z"/>
                  </svg>
                </div>
                <h3>Diretório de Terapeutas</h3>
                <p>Encontre outros terapeutas na plataforma</p>
              </div>

              <div className="dashboard-card services-card">
                <div className="card-header-sm">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 320 512" fill="currentColor">
                    <path d="M160 0c17.7 0 32 14.3 32 32V67.7c1.6 .2 3.1 .4 4.7 .7c.4 .1 .7 .1 1.1 .2l48 8.8c17.4 3.2 28.9 19.9 25.7 37.2s-19.9 28.9-37.2 25.7l-47.5-8.7c-31.3-4.6-58.9-1.5-78.3 6.2s-27.2 18.3-29.6 28.9c-5.5 24.3 11.7 58.2 72.5 81.9c5.6 2.2 11.1 4.2 16.6 6.1c40.2 13.8 82.1 28.2 104.6 56.3c14.1 17.5 20.4 38.5 18.4 59.9c-2.7 29.3-23.6 58.4-58.8 74c-8.7 3.9-18 7-27.8 9.1V480c0 17.7-14.3 32-32 32s-32-14.3-32-32V445.9c-.6-.1-1.1-.2-1.7-.3c-13.2-2.2-26.7-6.1-39.9-11.5c-37.4-15.3-63.2-41.5-69.3-70.5c-5.2-24.5 5.3-51.7 32.5-71.6c14.9-10.9 34.1-8.6 46.4 1.4s13.2 27.8 .1 41.9c-6.2 6.7-6.7 10.3-6.5 10.4c2 7.4 12.3 20.3 31.6 27.9c8.7 3.5 18.6 6 29.3 7.4c38.2 5.1 58.8-8.9 64.4-25.8c3.4-10.1 1.9-20.5-5.5-31c-10.5-14.4-31.7-23-64.8-34.5c-5.6-1.9-11.3-4-16.8-6.2c-91.6-35.6-130.6-99.9-111.9-183c7.3-32.6 25.5-60.2 51.7-80c19-14.4 41.6-24.7 66.1-30.3V32c0-17.7 14.3-32 32-32z"/>
                  </svg>
                  <h3>Serviços e Valores</h3>
                </div>
                <div className="dashboard-content">
                  <p><strong>Valor base:</strong> R$ {parseFloat(therapistData?.baseSessionPrice || 0).toFixed(2)}</p>
                  <p><strong>Duração da sessão:</strong> {therapistData?.sessionDuration || 60} minutos</p>
                  
                  {/* Ferramentas Terapêuticas */}
                  {therapistData?.tools && therapistData.tools.length > 0 && (
                    <div className="tools-section">
                      <h4>Ferramentas Terapêuticas:</h4>
                      <ul className="tools-list">
                        {therapistData.tools.map((tool, index) => (
                          <li key={index} className="tool-item">
                            <span className="tool-name">{tool.name}</span>
                            <span className="tool-details">
                              {tool.duration} min - R$ {tool.price}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {therapistData?.offersFreeSession && (
                    <p className="free-session-info">
                      <i className="fas fa-gift"></i>
                      <strong>Sessão experimental gratuita:</strong> {therapistData.freeSessionDuration || 30} minutos
                    </p>
                  )}
                  
                  <Button 
                    onClick={handleUpdateProfile}
                    variant="secondary"
                    className="btn-icon"
                  >
                    <i className="fas fa-edit"></i>
                    Editar Valores e Serviços
                  </Button>
                </div>
              </div>

              {/* Card para gerenciar disponibilidade simples */}
              <div className="dashboard-card" onClick={handleSetAvailabilitySimple}>
                <div className="card-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 448 512" fill="white">
                    <path d="M128 0c17.7 0 32 14.3 32 32V64H288V32c0-17.7 14.3-32 32-32s32 14.3 32 32V64h48c26.5 0 48 21.5 48 48v48H0V112C0 85.5 21.5 64 48 64H96V32c0-17.7 14.3-32 32-32zM0 192H448V464c0 26.5-21.5 48-48 48H48c-26.5 0-48-21.5-48-48V192zm328.8 83.7L176.5 402.6l-55.4-55.5c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l77.8 77.8c12 12 31.3 12.5 43.9 1.1l175.9-151c13.5-11.5 15.1-31.9 3.5-45.4s-31.9-15.1-45.4-3.5z"/>
                  </svg>
                </div>
                <h3>Disponibilidade Simplificada</h3>
                <p>Gerencie horários específicos de forma simples e direta</p>
              </div>
              
              {/* Card para criar sessão de teste */}
              <div className="dashboard-card test-card" onClick={handleCreateTestSession}>
                <div className="card-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 512 512" fill="white">
                    <path d="M176 24c0-13.3-10.7-24-24-24s-24 10.7-24 24V64c-35.3 0-64 28.7-64 64H24c-13.3 0-24 10.7-24 24s10.7 24 24 24H64v56H24c-13.3 0-24 10.7-24 24s10.7 24 24 24H64v56H24c-13.3 0-24 10.7-24 24s10.7 24 24 24H64c0 35.3 28.7 64 64 64v40c0 13.3 10.7 24 24 24s24-10.7 24-24V448h56v40c0 13.3 10.7 24 24 24s24-10.7 24-24V448h56v40c0 13.3 10.7 24 24 24s24-10.7 24-24V448c35.3 0 64-28.7 64-64h40c13.3 0 24-10.7 24-24s-10.7-24-24-24H448V280h40c13.3 0 24-10.7 24-24s-10.7-24-24-24H448V176h40c13.3 0 24-10.7 24-24s-10.7-24-24-24H448c0-35.3-28.7-64-64-64V24c0-13.3-10.7-24-24-24s-24 10.7-24 24V64H280V24c0-13.3-10.7-24-24-24s-24 10.7-24 24V64H176V24zM160 128H352c17.7 0 32 14.3 32 32V352c0 17.7-14.3 32-32 32H160c-17.7 0-32-14.3-32-32V160c0-17.7 14.3-32 32-32zm192 32H160V352H352V160z"/>
                  </svg>
                </div>
                <h3>Sessão de Teste</h3>
                <p>Criar uma sessão de teste para avaliar as funcionalidades</p>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default TherapistDashboard; 