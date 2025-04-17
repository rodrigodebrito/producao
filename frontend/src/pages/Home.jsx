import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Home.css';
import Button from '../components/Button';

const Home = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // Redirecionamento baseado no papel do usuário logado
  const redirectToDashboard = () => {
    if (user) {
      if (user.role === 'ADMIN') {
        navigate('/admin/dashboard');
      } else if (user.role === 'THERAPIST') {
        navigate('/therapist/dashboard');
      } else if (user.role === 'CLIENT') {
        navigate('/client/dashboard');
      }
    } else {
      navigate('/login');
    }
  };

  return (
    <div className="home-container">
      <section className="hero-section">
        <div className="gradient-overlay"></div>
        <div className="hero-content">
          <div className="logo-large">
            <div className="logo-icon">
              <svg width="60" height="60" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
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
            <h1>Thera<span className="highlight">Connect</span></h1>
          </div>
          <h2>Conectando caminhos para o bem-estar</h2>
          <p>
            Plataforma intuitiva para terapeutas e clientes realizarem 
            sessões online com ferramentas especializadas e suporte de IA.
          </p>
          <div className="hero-buttons">
            <Button 
              variant="primary" 
              size="large" 
              onClick={redirectToDashboard}
              className="btn-icon"
            >
              <i className="feather-icon feather-user-plus"></i>
              {user ? 'Acessar meu painel' : 'Começar agora'}
            </Button>
            {!user && (
              <Button 
                variant="secondary" 
                size="large" 
                onClick={() => navigate('/login')}
                className="btn-icon"
              >
                <i className="feather-icon feather-log-in"></i>
                Já tenho conta
              </Button>
            )}
          </div>
        </div>
        <div className="hero-image">
          <img src="/images/meditation-illustration.svg" alt="Bem-estar e terapia" />
        </div>
      </section>

      <section id="about" className="about-section">
        <div className="container">
          <div className="section-header">
            <span className="section-tag">Sobre nós</span>
            <h2>Conheça a TheraConnect</h2>
            <div className="section-divider"></div>
          </div>
          <div className="about-content">
            <div className="about-image">
              <img src="/images/about-illustration.svg" alt="Sobre a TheraConnect" />
            </div>
            <div className="about-text">
              <p>
                TheraConnect é uma plataforma completa para terapia online, criada com o objetivo de
                estabelecer conexões significativas entre terapeutas e clientes através da tecnologia.
              </p>
              <p>
                Nossa plataforma oferece ferramentas especializadas que potencializam o trabalho terapêutico,
                tornando as sessões online tão eficazes quanto as presenciais.
              </p>
              <ul className="about-features">
                <li>
                  <i className="feather-icon feather-video"></i>
                  <span>Videoconferência HD integrada</span>
                </li>
                <li>
                  <i className="feather-icon feather-calendar"></i>
                  <span>Agendamento inteligente</span>
                </li>
                <li>
                  <i className="feather-icon feather-activity"></i>
                  <span>Assistente de IA para análise</span>
                </li>
                <li>
                  <i className="feather-icon feather-shield"></i>
                  <span>Segurança e privacidade</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="features-section">
        <div className="container">
          <div className="section-header">
            <span className="section-tag">Nossos serviços</span>
            <h2>Como podemos ajudar</h2>
            <div className="section-divider"></div>
          </div>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">
                <i className="feather-icon feather-users"></i>
              </div>
              <h3>Para Terapeutas</h3>
              <p>Gerencie seu perfil profissional, controle sua disponibilidade e agenda, acesse histórico de atendimentos e ferramentas auxiliares.</p>
              <ul className="feature-list">
                <li><i className="feather-icon feather-check"></i> Perfil profissional personalizado</li>
                <li><i className="feather-icon feather-check"></i> Controle total de disponibilidade</li>
                <li><i className="feather-icon feather-check"></i> Relatórios e insights com IA</li>
                <li><i className="feather-icon feather-check"></i> Ferramentas terapêuticas especializadas</li>
              </ul>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">
                <i className="feather-icon feather-heart"></i>
              </div>
              <h3>Para Clientes</h3>
              <p>Encontre terapeutas especializados, agende sessões online, acompanhe seu progresso e tenha uma experiência terapêutica completa.</p>
              <ul className="feature-list">
                <li><i className="feather-icon feather-check"></i> Busca de terapeutas por especialidade</li>
                <li><i className="feather-icon feather-check"></i> Agendamento online simplificado</li>
                <li><i className="feather-icon feather-check"></i> Sessões em videoconferência HD</li>
                <li><i className="feather-icon feather-check"></i> Histórico completo de sessões</li>
              </ul>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">
                <i className="feather-icon feather-zap"></i>
              </div>
              <h3>Ferramentas Especializadas</h3>
              <p>Acesse ferramentas terapêuticas especializadas que enriquecem o trabalho terapêutico e facilitam conexões profundas.</p>
              <ul className="feature-list">
                <li><i className="feather-icon feather-check"></i> Campo de Constelação virtual</li>
                <li><i className="feather-icon feather-check"></i> Transcrição automática de sessões</li>
                <li><i className="feather-icon feather-check"></i> Análise emocional com IA</li>
                <li><i className="feather-icon feather-check"></i> Geração de relatórios personalizados</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="testimonials" className="testimonials-section">
        <div className="container">
          <div className="section-header">
            <span className="section-tag">Depoimentos</span>
            <h2>O que dizem nossos usuários</h2>
            <div className="section-divider"></div>
          </div>
          <div className="testimonials-grid">
            <div className="testimonial-card">
              <div className="testimonial-quote">
                <i className="feather-icon feather-message-circle"></i>
              </div>
              <p className="testimonial-text">
                "Como terapeuta, essa plataforma revolucionou minha prática. As ferramentas de IA e a interface intuitiva me ajudam a acompanhar melhor meus clientes. A qualidade da videoconferência é excelente!"
              </p>
              <div className="testimonial-author">
                <div className="author-avatar">M</div>
                <div className="author-info">
                  <p className="author-name">Maria Silva</p>
                  <p className="author-role">Psicóloga</p>
                </div>
              </div>
            </div>
            
            <div className="testimonial-card">
              <div className="testimonial-quote">
                <i className="feather-icon feather-message-circle"></i>
              </div>
              <p className="testimonial-text">
                "Encontrar um terapeuta nunca foi tão fácil. A plataforma me conectou com o profissional ideal para minhas necessidades e a experiência das sessões online é surpreendentemente acolhedora."
              </p>
              <div className="testimonial-author">
                <div className="author-avatar">P</div>
                <div className="author-info">
                  <p className="author-name">Paulo Mendes</p>
                  <p className="author-role">Cliente</p>
                </div>
              </div>
            </div>
            
            <div className="testimonial-card">
              <div className="testimonial-quote">
                <i className="feather-icon feather-message-circle"></i>
              </div>
              <p className="testimonial-text">
                "O Campo de Constelação virtual é incrível! Consegui realizar trabalhos tão profundos quanto nas sessões presenciais, com a vantagem de atender clientes em qualquer lugar do mundo."
              </p>
              <div className="testimonial-author">
                <div className="author-avatar">C</div>
                <div className="author-info">
                  <p className="author-name">Carla Andrade</p>
                  <p className="author-role">Consteladora Familiar</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="cta" className="cta-section">
        <div className="container">
          <div className="cta-content">
            <h2>Pronto para transformar sua experiência terapêutica?</h2>
            <p>Junte-se a milhares de terapeutas e clientes que já estão conectados em nossa plataforma.</p>
            <Button 
              variant="primary" 
              size="large" 
              onClick={redirectToDashboard}
              className="btn-icon"
            >
              <i className="feather-icon feather-arrow-right"></i>
              Começar agora
            </Button>
          </div>
        </div>
      </section>

      <footer className="home-footer">
        <div className="container">
          <div className="footer-content">
            <div className="footer-logo">
              <div className="logo-small">
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
                <h3>Thera<span className="highlight">Connect</span></h3>
              </div>
              <p>Conectando caminhos para o bem-estar</p>
            </div>
            
            <div className="footer-links">
              <div className="footer-section">
                <h4>Navegação</h4>
                <a href="#about">Sobre nós</a>
                <a href="#features">Serviços</a>
                <a href="#testimonials">Depoimentos</a>
                <a href="#cta">Começar</a>
              </div>
              
              <div className="footer-section">
                <h4>Legal</h4>
                <a href="#">Termos de Uso</a>
                <a href="#">Política de Privacidade</a>
                <a href="#">LGPD</a>
              </div>
              
              <div className="footer-section">
                <h4>Contato</h4>
                <a href="mailto:contato@theraconnect.com" className="footer-contact">
                  <i className="feather-icon feather-mail"></i>
                  contato@theraconnect.com
                </a>
                <a href="tel:+551199999999" className="footer-contact">
                  <i className="feather-icon feather-phone"></i>
                  (11) 9999-9999
                </a>
                <div className="social-links">
                  <a href="#" aria-label="Instagram">
                    <i className="feather-icon feather-instagram"></i>
                  </a>
                  <a href="#" aria-label="LinkedIn">
                    <i className="feather-icon feather-linkedin"></i>
                  </a>
                  <a href="#" aria-label="Facebook">
                    <i className="feather-icon feather-facebook"></i>
                  </a>
                </div>
              </div>
            </div>
          </div>
          
          <div className="footer-bottom">
            <p>&copy; {new Date().getFullYear()} TheraConnect. Todos os direitos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Home; 