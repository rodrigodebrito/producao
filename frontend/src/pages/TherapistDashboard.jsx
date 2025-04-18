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
            <i className="fas fa-sign-out-alt"></i>
            Sair
          </Button>
        </div>
      </header>

      <main className="dashboard-content">
        {loading ? (
          <div className="loading-indicator">
            <i className="fas fa-spinner fa-spin"></i>
            <span>Carregando...</span>
          </div>
        ) : error ? (
          <div className="error-message">
            <i className="fas fa-exclamation-circle"></i>
            <p>{error}</p>
          </div>
        ) : (
          <>
            {!isProfileComplete() && (
              <div className="alert-message">
                <div className="alert-header">
                  <i className="fas fa-exclamation-triangle"></i>
                  <strong>Seu perfil está incompleto!</strong>
                </div>
                <p>Complete seu perfil para aumentar suas chances de conseguir clientes.</p>
                <Button 
                  onClick={handleUpdateProfile} 
                  variant="warning"
                  className="btn-icon"
                >
                  <i className="fas fa-edit"></i>
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
                    <i className="fas fa-calendar-alt"></i>
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
                      <i className="fas fa-list"></i>
                      Ver Agenda Completa
                    </Button>
                  </div>
                </div>
              </section>

              <section className="quick-actions card">
                <div className="card-header">
                  <h3>
                    <i className="fas fa-bolt"></i>
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
                      <i className="fas fa-calendar-alt"></i>
                      Gerenciar Agenda
                    </Button>
                    <Button 
                      onClick={handleUpdateProfile} 
                      variant="secondary"
                      className="btn-icon action-button"
                    >
                      <i className="fas fa-user"></i>
                      Atualizar Perfil
                    </Button>
                    <Button 
                      onClick={handleSetAvailability} 
                      variant="secondary"
                      className="btn-icon action-button"
                    >
                      <i className="fas fa-clock"></i>
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
                  <i className="fas fa-user"></i>
                </div>
                <h3>Perfil Profissional</h3>
                <p>Edite seu perfil e configure seus serviços</p>
              </div>
              
              <div className="dashboard-card" onClick={handleSetAvailability}>
                <div className="card-icon">
                  <i className="fas fa-clock"></i>
                </div>
                <h3>Minha Disponibilidade</h3>
                <p>Configure os horários que você está disponível</p>
              </div>
              
              <div className="dashboard-card" onClick={handleManageSchedule}>
                <div className="card-icon">
                  <i className="fas fa-calendar-alt"></i>
                </div>
                <h3>Agenda</h3>
                <p>Visualize e gerencie seus agendamentos</p>
              </div>
              
              <div className="dashboard-card" onClick={() => navigate('/directory')}>
                <div className="card-icon">
                  <i className="fas fa-search"></i>
                </div>
                <h3>Diretório de Terapeutas</h3>
                <p>Encontre outros terapeutas na plataforma</p>
              </div>

              <div className="dashboard-card services-card">
                <div className="card-header-sm">
                  <i className="fas fa-dollar-sign"></i>
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
                  <i className="fas fa-calendar-check"></i>
                </div>
                <h3>Disponibilidade Simplificada</h3>
                <p>Gerencie horários específicos de forma simples e direta</p>
              </div>
              
              {/* Card para criar sessão de teste */}
              <div className="dashboard-card test-card" onClick={handleCreateTestSession}>
                <div className="card-icon">
                  <i className="fas fa-microchip"></i>
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