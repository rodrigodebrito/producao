import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getFullImageUrl } from '../utils/constants';
import './Header.css';

const Header = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  
  const handleLogout = () => {
    logout();
    navigate('/login');
  };
  
  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
  };

  const isActive = (path) => {
    return location.pathname === path;
  };
  
  // Fechar o menu quando o usuário clica fora dele
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    // Adicionar event listener quando o menu está aberto
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    // Cleanup: remover event listener quando o componente é desmontado ou o menu é fechado
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen]);
  
  return (
    <header className="main-header">
      <div className="header-container">
        <div className="header-left">
          <Link to="/" className="logo">
            <div className="logo-icon">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10.5 8C7.5 11 4.5 15.5 8.5 19.5C12.5 23.5 16 20.5 19 18" stroke="url(#paint0_linear)" strokeWidth="2" strokeLinecap="round"/>
                <path d="M21.5 8C24.5 11 27.5 15.5 23.5 19.5C19.5 23.5 16 20.5 13 18" stroke="url(#paint1_linear)" strokeWidth="2" strokeLinecap="round"/>
                <defs>
                  <linearGradient id="paint0_linear" x1="7" y1="8" x2="19" y2="19" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#4A90E2"/>
                    <stop offset="1" stopColor="#A3D9C9"/>
                  </linearGradient>
                  <linearGradient id="paint1_linear" x1="25" y1="8" x2="13" y2="19" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#4A90E2"/>
                    <stop offset="1" stopColor="#A3D9C9"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <span className="logo-text">Thera<span className="logo-highlight">Connect</span></span>
          </Link>
          
          {user && user.role === 'THERAPIST' && (
            <nav className="nav-links">
              <Link to="/therapist/dashboard" className={isActive('/therapist/dashboard') ? 'active' : ''}>
                <i className="feather-icon feather-home"></i>
                Início
              </Link>
              <Link to="/therapist/appointments" className={isActive('/therapist/appointments') ? 'active' : ''}>
                <i className="feather-icon feather-calendar"></i>
                Minha Agenda
              </Link>
              <Link to="/therapist/availability" className={isActive('/therapist/availability') ? 'active' : ''}>
                <i className="feather-icon feather-clock"></i>
                Disponibilidade
              </Link>
            </nav>
          )}
          
          {user && user.role === 'CLIENT' && (
            <nav className="nav-links">
              <Link to="/client/dashboard" className={isActive('/client/dashboard') ? 'active' : ''}>
                <i className="feather-icon feather-home"></i>
                Início
              </Link>
              <Link to="/client/appointments" className={isActive('/client/appointments') ? 'active' : ''}>
                <i className="feather-icon feather-calendar"></i>
                Minhas Consultas
              </Link>
              <Link to="/directory" className={isActive('/directory') ? 'active' : ''}>
                <i className="feather-icon feather-search"></i>
                Encontrar Terapeuta
              </Link>
            </nav>
          )}
        </div>
        
        <div className="header-right">
          {user ? (
            <>
              <button className="language-selector">
                Português, BRL
                <i className="feather-icon feather-chevron-down"></i>
              </button>
            
              <Link to="/notifications" className="notifications-button">
                <i className="feather-icon feather-bell"></i>
              </Link>
            
              <div className="user-menu-container" ref={menuRef}>
                <button className="user-menu-button" onClick={toggleMenu}>
                  {user.profilePicture ? (
                    <img 
                      src={getFullImageUrl(user.profilePicture)} 
                      alt={user.name} 
                      className="user-avatar" 
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = '/images/default-profile.png';
                      }}
                    />
                  ) : (
                    <div className="user-avatar-placeholder">
                      <span>{user.name.charAt(0)}</span>
                    </div>
                  )}
                </button>
                
                {menuOpen && (
                  <div className="user-dropdown">
                    <div className="dropdown-header">
                      <p className="user-greeting">Olá, {user.name.split(' ')[0]}</p>
                      {user.role === 'THERAPIST' && (
                        <p className="user-info">{user.name.split(' ').slice(1).join(' ')}</p>
                      )}
                    </div>
                    
                    {user.role === 'THERAPIST' && (
                      <>
                        <Link to="/therapist/profile" className="dropdown-item">
                          <i className="feather-icon feather-user"></i>
                          Meu Perfil
                        </Link>
                        <Link to="/therapist/profile/view" className="dropdown-item">
                          <i className="feather-icon feather-eye"></i>
                          Visualizar Meu Perfil
                        </Link>
                      </>
                    )}
                    
                    {user.role === 'CLIENT' && (
                      <Link to="/client/profile" className="dropdown-item">
                        <i className="feather-icon feather-user"></i>
                        Meu Perfil
                      </Link>
                    )}
                    
                    <Link to="/settings" className="dropdown-item">
                      <i className="feather-icon feather-settings"></i>
                      Configurações
                    </Link>
                    
                    <button onClick={handleLogout} className="logout-button">
                      <i className="feather-icon feather-log-out"></i>
                      Sair
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <button className="language-selector">
                Português, BRL
                <i className="feather-icon feather-chevron-down"></i>
              </button>
              
              <div className="auth-buttons">
                <Link to="/login" className="btn-secondary">
                  Entrar
                </Link>
                <Link to="/register" className="btn-primary">
                  Cadastrar
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header; 