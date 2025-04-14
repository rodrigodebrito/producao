import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { AIProvider } from './contexts/AIContext';
import Header from './components/Header';
import Login from './pages/Login';
import Register from './pages/Register';
import Home from './pages/Home';
import NotFound from './pages/NotFound';
import Dashboard from './pages/Dashboard';
import TherapistProfile from './pages/TherapistProfile';
import TherapistProfileView from './pages/TherapistProfileView';
import TherapistDashboard from './pages/TherapistDashboard';
import TherapistSchedule from './pages/TherapistSchedule';
import TherapistDirectory from './pages/TherapistDirectory';
import TherapistPublicProfile from './pages/TherapistPublicProfile';
import AppointmentScheduling from './pages/AppointmentScheduling';
import AppointmentSuccess from './pages/AppointmentSuccess';
import AdminDashboard from './pages/AdminDashboard';
import ClientAppointments from './pages/ClientAppointments';
import Appointments from './pages/Appointments';
import ClientProfile from './pages/ClientProfile';
import TherapistAvailabilitySimple from './pages/TherapistAvailabilitySimple';
import SessionRoom from './pages/SessionRoom';
import './App.css';
import { Toaster } from 'react-hot-toast';
import AdminLogin from './pages/AdminLogin';

// Importar o componente de Constelação
import ConstellationField from './components/ConstellationField/index';

// Componente para rotas protegidas
const ProtectedRoute = ({ element, allowedRoles }) => {
  const { user, loading } = useAuth();
  
  // Esperar enquanto verifica autenticação
  if (loading) {
    return <div className="loading">Carregando...</div>;
  }
  
  // Verificar se o usuário está logado
  if (!user) {
    return <Navigate to="/login" />;
  }
  
  // Se não há roles definidas ou o usuário tem a permissão necessária, permitir acesso
  if (!allowedRoles || allowedRoles.includes(user.role)) {
    return (
      <>
        <Header />
        {element}
      </>
    );
  }
  
  // Se o usuário não tem permissão, redirecionar para seu dashboard
  const dashboardRoutes = {
    CLIENT: '/client/dashboard',
    THERAPIST: '/therapist/dashboard',
    ADMIN: '/admin/dashboard'
  };
  
  return <Navigate to={dashboardRoutes[user.role]} />;
};

function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <AIProvider>
          <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <div className="App">
              <Toaster position="top-right" />
              <Routes>
                {/* Rotas públicas */}
                <Route path="/" element={<Home />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                
                {/* Rota pública para o teste de Constelação */}
                <Route path="/teste-constelacao" element={
                  <div className="constellation-test-container">
                    <ConstellationField isHost={true} sessionId={"teste-publico"} />
                  </div>
                } />
                
                {/* Redirecionamento da rota antiga para a nova */}
                <Route path="/therapists" element={<Navigate to="/directory" replace />} />
                
                {/* Diretório de terapeutas (disponível para todos, mas com header para usuários logados) */}
                <Route 
                  path="/directory" 
                  element={<ProtectedRoute element={<TherapistDirectory />} allowedRoles={['CLIENT', 'THERAPIST', 'ADMIN']} />} 
                />
                <Route 
                  path="/therapist/:id" 
                  element={<ProtectedRoute element={<TherapistProfileView />} allowedRoles={['CLIENT', 'THERAPIST', 'ADMIN']} />} 
                />
                
                {/* Perfil público do terapeuta */}
                <Route 
                  path="/therapist-profile/:id" 
                  element={<ProtectedRoute element={<TherapistPublicProfile />} allowedRoles={['CLIENT', 'THERAPIST', 'ADMIN']} />} 
                />
                
                {/* Agendamento de consultas */}
                <Route 
                  path="/schedule/:id" 
                  element={<ProtectedRoute element={<AppointmentScheduling />} allowedRoles={['CLIENT', 'THERAPIST', 'ADMIN']} />} 
                />
                
                {/* Rotas para clientes */}
                <Route 
                  path="/client/dashboard" 
                  element={<ProtectedRoute element={<Dashboard />} allowedRoles={['CLIENT']} />} 
                />
                <Route 
                  path="/client/appointments" 
                  element={<ProtectedRoute element={<Appointments />} allowedRoles={['CLIENT']} />} 
                />
                <Route 
                  path="/client/profile" 
                  element={<ProtectedRoute element={<ClientProfile />} allowedRoles={['CLIENT']} />} 
                />
                
                {/* Rotas para terapeutas */}
                <Route 
                  path="/therapist/dashboard" 
                  element={<ProtectedRoute element={<TherapistDashboard />} allowedRoles={['THERAPIST']} />} 
                />
                <Route 
                  path="/therapist/profile" 
                  element={<ProtectedRoute element={<TherapistProfile />} allowedRoles={['THERAPIST']} />} 
                />
                <Route 
                  path="/therapist/profile/view" 
                  element={<ProtectedRoute element={<TherapistProfileView />} allowedRoles={['THERAPIST']} />} 
                />
                <Route 
                  path="/therapist/schedule" 
                  element={<ProtectedRoute element={<TherapistSchedule />} allowedRoles={['THERAPIST']} />} 
                />
                <Route 
                  path="/therapist/availability" 
                  element={<ProtectedRoute element={<TherapistAvailabilitySimple />} allowedRoles={['THERAPIST']} />} 
                />
                <Route 
                  path="/therapist/appointments" 
                  element={<ProtectedRoute element={<Appointments />} allowedRoles={['THERAPIST']} />} 
                />
                
                {/* Rotas para administradores */}
                <Route 
                  path="/admin/dashboard" 
                  element={<ProtectedRoute element={<AdminDashboard />} allowedRoles={['ADMIN']} />} 
                />
                
                {/* Página de login administrativo (sem header) */}
                <Route path="/admin/login" element={<AdminLogin />} />
                
                {/* Rota de teste para o Campo de Constelação */}
                <Route 
                  path="/constellation" 
                  element={<ProtectedRoute element={<ConstellationField />} allowedRoles={['CLIENT', 'THERAPIST', 'ADMIN']} />} 
                />
                
                {/* Rota para a sala de sessão */}
                <Route 
                  path="/session/:sessionId" 
                  element={<ProtectedRoute element={<SessionRoom />} allowedRoles={['CLIENT', 'THERAPIST']} />} 
                />
                
                {/* Rota para página de sucesso de agendamento */}
                <Route 
                  path="/appointment-success" 
                  element={<ProtectedRoute element={<AppointmentSuccess />} allowedRoles={['CLIENT']} />} 
                />
                
                {/* Fallback para página não encontrada */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </div>
          </Router>
        </AIProvider>
      </NotificationProvider>
    </AuthProvider>
  );
}

export default App;
