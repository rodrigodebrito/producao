import React, { useEffect, useRef, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { toast } from 'react-toastify';
import './FallbackMeeting.css';
import config from '../environments';
import api from '../services/api';
import { joinMeeting, validateRoom } from '../services/meetingService';

// Componente de erro para capturar falhas na renderização do vídeo
class VideoErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Erro no componente de vídeo:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="video-error-container" style={{
          padding: '20px',
          textAlign: 'center',
          backgroundColor: '#f8d7da',
          color: '#721c24',
          borderRadius: '5px'
        }}>
          <h3>Houve um problema com a videoconferência</h3>
          <button 
            onClick={() => {
              this.setState({ hasError: false });
              if (this.props.onReset) this.props.onReset();
            }}
            style={{
              padding: '8px 16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginTop: '10px'
            }}
          >
            Tentar Novamente
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Componente para iframe do Daily
const DailyFrame = ({ roomUrl, onLoad }) => {
  const iframeRef = useRef(null);
  
  useEffect(() => {
    console.log('Daily.co iframe carregando: ' + roomUrl);
    if (iframeRef.current) {
      iframeRef.current.setAttribute('allow', 'camera; microphone; fullscreen; speaker; display-capture');
      onLoad && onLoad(iframeRef.current);
    }
  }, [roomUrl, onLoad]);
  
  return (
    <iframe
      title="Daily.co Meeting"
      ref={iframeRef}
      id="daily-iframe"
      className="daily-iframe"
      src={roomUrl}
      allow="camera; microphone; fullscreen; speaker; display-capture"
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        backgroundColor: '#1a1a1a',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0
      }}
    />
  );
};

const FallbackMeeting = ({
  roomName,
  userName = 'Usuário',
  audioEnabled = true,
  videoEnabled = true,
  floating = false,
  onPipModeChange = () => {},
}) => {
  // ========== HOOKS ==========
  const isMountedRef = useRef(true);
  const videoContainerRef = useRef(null);
  const dailyFrameRef = useRef(null);
  
  // ========== STATE HOOKS ==========
  const [sessionDetails, setSessionDetails] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isPipMode, setIsPipMode] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(videoEnabled);
  const [waitingForTherapist, setWaitingForTherapist] = useState(false);
  
  // Função para obter a URL da sala usando o serviço de meeting
  const getRoomUrl = useCallback(async () => {
    try {
      console.log('Verificando/criando sala via API:', roomName);
      
      // Verificar se estamos em um contexto de sessão
      const isSessionContext = roomName && (
        roomName.includes('session-') || 
        roomName.includes('-session') || 
        roomName.includes('sessao-') ||
        roomName.length > 30 // UUIDs geralmente são longos (IDs de sessão)
      );
      
      if (isSessionContext) {
        // Usar o serviço joinMeeting para obter URL da sala se for contexto de sessão
        const userRole = localStorage.getItem('userRole') || '';
        console.log('Contexto de sessão detectado, usando joinMeeting. Role:', userRole);
        
        try {
          const meetingData = await joinMeeting(roomName);
          console.log('Dados da reunião obtidos via joinMeeting:', meetingData);
          
          // Retornar a URL da sala do Daily.co
          return meetingData.roomName || meetingData.url;
        } catch (sessionError) {
          // Se for erro de sala não criada e usuário for cliente
          if (sessionError.message?.includes('não foi criada') || 
              sessionError.message?.includes('Aguarde o terapeuta')) {
            console.log('Cliente tentando acessar sala que ainda não foi criada pelo terapeuta');
            setWaitingForTherapist(true);
            throw new Error('WAITING_FOR_THERAPIST');
          }
          
          // Se for erro de horário (cliente tentando acessar fora do horário)
          if (sessionError.message?.includes('horário agendado')) {
            console.log('Cliente tentando acessar sala fora do horário agendado');
            throw new Error('OUTSIDE_SCHEDULED_TIME');
          }
          
          // Propagar outros erros
          throw sessionError;
        }
      }
      
      // Usar o serviço validateRoom para validar/criar sala
      console.log('Chamando validateRoom para a sala:', roomName);
      
      try {
        // Verificar se a sala existe ou criar uma nova através do backend
        const roomData = await validateRoom(roomName);
        
        console.log('Resposta da validação da sala:', roomData);
        
        let baseUrl = null;
        
        // Verificar diferentes formatos possíveis de resposta
        if (roomData.url) {
          baseUrl = roomData.url;
        } else if (roomData.success && roomData.url) {
          baseUrl = roomData.url;
        } else {
          throw new Error('Formato de resposta desconhecido');
        }
        
        console.log('URL da sala validada:', baseUrl);
        
        // Construir parâmetros da URL
        const params = new URLSearchParams();
        
        // Adicionar nome do usuário se disponível
        if (userName) {
          params.append('name', userName);
        }
        
        // Configurações básicas
        params.append('showLeaveButton', 'true');
        params.append('showFullscreenButton', 'true');
        
        // Áudio e vídeo
        params.append('startAudioOff', !audioEnabled);
        params.append('startVideoOff', !videoEnabled);
        
        // Construir URL final
        const finalUrl = `${baseUrl}?${params.toString()}`;
        console.log('URL final da sala:', finalUrl);
        
        return finalUrl;
      } catch (validationError) {
        console.error('Erro na validação da sala:', validationError);
        
        // Se for erro de permissão (403), verificar se é terapeuta
        if (validationError.response && validationError.response.status === 403) {
          const userRole = localStorage.getItem('userRole');
          if (userRole === 'THERAPIST') {
            toast.error('Não foi possível validar sua sala. Verifique sua conexão e permissões.');
          } else {
            setError('Apenas terapeutas podem criar salas de videoconferência');
            return null;
          }
        }
        
        // Se for erro de autenticação (401)
        if (validationError.response && validationError.response.status === 401) {
          setError('Erro de autenticação. Por favor, recarregue a página e faça login novamente.');
          return null;
        }
        
        throw validationError;
      }
    } catch (err) {
      console.error('Erro ao obter URL da sala:', err);
      
      // Se estiver aguardando o terapeuta, não criar fallback
      if (err.message === 'WAITING_FOR_THERAPIST') {
        setError('Aguardando o terapeuta iniciar a sessão');
        return null;
      }
      
      // Se o erro for de horário, mostrar mensagem específica
      if (err.message === 'OUTSIDE_SCHEDULED_TIME') {
        setError('Você não pode acessar a sala fora do horário agendado');
        return null;
      }
      
      // Tentar extrair mais informações do erro
      console.log('Detalhes do erro:', err.response?.data || err.message);
      
      // Fallback extremo: Criar URL direta para o Daily.co
      // Recomendável usar apenas os primeiros caracteres do ID para evitar problemas
      const simplifiedId = roomName.includes('-') ? 
        roomName.split('-')[0] : 
        roomName.substring(0, 8);
        
      console.log(`Usando ID simplificado para fallback: ${simplifiedId}`);
      
      // Construir URL de fallback
      const dailyUrl = 'https://teraconect.daily.co';
      const fallbackUrl = `${dailyUrl}/tc-${simplifiedId}`;
      
      // Construir parâmetros
      const params = new URLSearchParams();
      if (userName) params.append('name', userName);
      params.append('showLeaveButton', 'true');
      params.append('showFullscreenButton', 'true');
      params.append('startAudioOff', !audioEnabled);
      params.append('startVideoOff', !videoEnabled);
      
      const finalUrl = `${fallbackUrl}?${params.toString()}`;
      console.log('URL final da sala (fallback extremo):', finalUrl);
      
      return finalUrl;
    }
  }, [roomName, userName, audioEnabled, videoEnabled]);

  // Carregar dados da sessão e inicializar a chamada
  useEffect(() => {
    const startSession = async () => {
      try {
        // Limpar transcrições antigas ao iniciar uma nova sessão
        await clearPreviousTranscriptions();
        
        // Desativar referência ao HybridAI para versão sem IA (06bcfc6)
        if (window.__HYBRID_AI_DISABLED) {
          console.log('⛔ FallbackMeeting: HybridAI desativado nesta versão');
          // Limpar qualquer referência global para garantir
          window.hybridAIService = null;
          window.HybridAIService = null;
        }
        
        setIsLoading(true);
        
        // Obter URL da sala 
        const roomUrl = await getRoomUrl();
        
        // Se não conseguimos URL (e não há erro específico), mostrar erro genérico
        if (!roomUrl && !error) {
          setError('Não foi possível inicializar a sala de videoconferência');
          setIsLoading(false);
          return;
        }
        
        // Se temos um erro de espera pelo terapeuta, não tentar continuar
        if (waitingForTherapist) {
          setIsLoading(false);
          return;
        }
        
        // Configurar detalhes da sessão
        setSessionDetails({
          url: roomUrl,
          roomName,
          userName
        });
        
        setIsLoading(false);
      } catch (err) {
        console.error('Erro ao inicializar sessão:', err);
        setError(err.message || 'Não foi possível inicializar a sessão de vídeo. Por favor, recarregue a página.');
        setIsLoading(false);
      }
    };
    
    startSession();
  }, [roomName, userName, getRoomUrl, error, waitingForTherapist]);
  
  // Função para limpar transcrições antigas
  const clearPreviousTranscriptions = useCallback(async () => {
    try {
      console.log('Limpando transcrições antigas ao iniciar nova sessão');
      
      // Esperar inicialização completa antes de limpar (com timeout)
      const waitForWhisperService = async (timeoutMs = 5000) => {
        return new Promise((resolve) => {
          // Se já temos o serviço inicializado, prosseguir imediatamente
          if (window.whisperService && typeof window.whisperService.clearTranscriptions === 'function') {
            console.log('WhisperService já está disponível e inicializado');
            resolve(true);
            return;
          }
          
          // Definir timeout para não bloquear infinitamente
          const timeoutId = setTimeout(() => {
            console.log('Timeout ao aguardar inicialização do WhisperService');
            resolve(false);
          }, timeoutMs);
          
          // Verificar a cada 300ms
          const checkInterval = setInterval(() => {
            if (window.whisperService && typeof window.whisperService.clearTranscriptions === 'function') {
              clearInterval(checkInterval);
              clearTimeout(timeoutId);
              console.log('WhisperService ficou disponível durante a espera');
              resolve(true);
            }
          }, 300);
        });
      };
      
      // Aguardar inicialização completa do serviço (até 5 segundos)
      const serviceReady = await waitForWhisperService();
      
      // Limpar via serviço de transcrição se disponível
      if (serviceReady) {
        console.log('Usando clearTranscriptions() do WhisperService');
        window.whisperService.clearTranscriptions();
        console.log('Transcrições antigas limpas via WhisperTranscriptionService');
      } else {
        // Limpar manualmente via localStorage/sessionStorage
        console.log('WhisperService não disponível, limpando manualmente');
        
        // 1. Extrair o sessionId atual da URL
        const url = window.location.href;
        const sessionMatch = url.match(/\/session\/([a-zA-Z0-9_-]+)/);
        const uuidMatch = url.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
        
        const currentSessionId = 
          (sessionMatch && sessionMatch[1]) || 
          (uuidMatch && uuidMatch[0]) || 
          localStorage.getItem('currentSessionId') || 
          sessionStorage.getItem('currentSessionId') ||
          null;
        
        if (currentSessionId) {
          // 2. Remover dados de transcrição dessa sessão e de TODAS as sessões anteriores
          console.log(`Limpando transcrições da sessão ${currentSessionId} e outras sessões anteriores`);
          
          // Remover dados específicos desta sessão
          sessionStorage.removeItem(`whisper_transcriptions_${currentSessionId}`);
          sessionStorage.removeItem(`last_transcript_${currentSessionId}`);
          localStorage.removeItem(`whisper_transcript_${currentSessionId}`);
          
          // Limpar todas as chaves do sessionStorage e localStorage relacionadas a transcrições
          // para garantir que não haja resíduos de sessões anteriores
          try {
            // Limpar do sessionStorage
            Object.keys(sessionStorage).forEach(key => {
              if (key.startsWith('whisper_transcriptions_') || 
                  key.startsWith('last_transcript_')) {
                console.log(`Removendo chave do sessionStorage: ${key}`);
                sessionStorage.removeItem(key);
              }
            });
            
            // Limpar do localStorage
            Object.keys(localStorage).forEach(key => {
              if (key.startsWith('whisper_transcript_')) {
                console.log(`Removendo chave do localStorage: ${key}`);
                localStorage.removeItem(key);
              }
            });
          } catch (storageError) {
            console.error('Erro ao limpar chaves de armazenamento:', storageError);
          }
          
          // 3. Notificar usuário
          toast.info('Transcrições anteriores foram limpas para uma nova sessão', {
            autoClose: 3000
          });
        } else {
          console.log('Não foi possível determinar o ID da sessão para limpar transcrições');
        }
      }
      
      // 4. Limpar transcrições no AIContext se existir
      if (window.__AI_CONTEXT && typeof window.__AI_CONTEXT.clearTranscript === 'function') {
        window.__AI_CONTEXT.clearTranscript();
        console.log('Transcrições limpas no AIContext');
      }
    } catch (error) {
      console.error('Erro ao limpar transcrições antigas:', error);
    }
  }, []);
  
  // Callback quando o iframe é carregado
  const handleIframeLoad = useCallback((iframeElement) => {
    console.log('Daily iframe carregado com sucesso');
    dailyFrameRef.current = iframeElement;
    setIsVideoEnabled(true);
    setIsLoading(false);
    
    // Adicionar classe para indicar que o iframe está carregado
    if (iframeElement) {
      iframeElement.classList.add('loaded');
    }
  }, []);

  // PIP e controles de tela
  const handlePipClick = useCallback(() => {
    if (!videoContainerRef.current) return;
    
    try {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture();
        onPipModeChange(false);
        setIsPipMode(false);
      } else {
        const video = videoContainerRef.current.querySelector('video');
        if (video) {
          video.requestPictureInPicture()
            .then(() => {
              setIsPipMode(true);
              onPipModeChange(true);
            })
            .catch(e => {
              console.error('Erro ao ativar PiP:', e);
            });
        } else {
          console.error('Nenhum elemento de vídeo encontrado para PiP');
        }
        }
      } catch (e) {
      console.error('Erro ao alternar modo PiP:', e);
      }
  }, [onPipModeChange]);
  
  // Adicionar CSS para os botões e a transcrição
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .daily-container {
        position: relative;
        width: 100%;
        height: 100%;
      }
      
      .pip-button {
        position: absolute;
        top: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.5);
        color: white;
        border: none;
        border-radius: 4px;
        padding: 5px 10px;
        font-size: 12px;
        cursor: pointer;
        z-index: 10;
      }
    `;
    
    document.head.appendChild(style);
    
    return () => {
      if (style.parentNode) {
        style.parentNode.removeChild(style);
      }
    };
  }, []);
  
  // ========== RENDER ==========
  // Renderizar durante carregamento
  if (isLoading) {
  return (
      <div className="fallback-loading">
        <div className="loading-spinner"></div>
        <p>Carregando videoconferência...</p>
            </div>
    );
  }

  // Renderizar em caso de erro
  if (error) {
    return (
      <div className="fallback-error">
        <p>{error}</p>
        <button onClick={() => window.location.reload()} className="retry-button">
                Tentar Novamente
            </button>
        </div>
    );
  }

  // Renderizar a reunião
  return (
    <div className={`video-call-container ${floating ? 'floating' : 'fullscreen'} ${isPipMode ? 'pip-mode' : ''}`}>
      <div className="video-wrapper" ref={videoContainerRef}>
        {isLoading && (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Conectando à sala de videoconferência...</p>
          </div>
        )}
        
        {!isLoading && error && (
          <div className="error-container">
            <div className="error-message">
              <h3>{waitingForTherapist ? 'Aguardando terapeuta' : 'Erro de conexão'}</h3>
              <p>{error}</p>
              {waitingForTherapist && (
                <p className="info-message">O terapeuta precisa iniciar a sessão antes que você possa entrar. 
                Por favor, aguarde ou entre em contato com seu terapeuta.</p>
              )}
              <button 
                onClick={() => {
                  setError(null);
                  setIsLoading(true);
                  setTimeout(() => window.location.reload(), 500);
                }}
                className="retry-button"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        )}
        
        {!isLoading && !error && sessionDetails && (
          <VideoErrorBoundary onReset={() => window.location.reload()}>
            <DailyFrame 
              roomUrl={sessionDetails.url} 
              onLoad={(iframe) => {
                if (dailyFrameRef.current !== iframe) {
                  dailyFrameRef.current = iframe;
                }
              }} 
            />
          </VideoErrorBoundary>
        )}
      </div>
      
      {document.pictureInPictureEnabled && !floating && isVideoEnabled && (
        <button 
          onClick={handlePipClick}
          className="pip-button"
        >
          PiP
        </button>
      )}
    </div>
  );
};

FallbackMeeting.propTypes = {
  roomName: PropTypes.string.isRequired,
  userName: PropTypes.string,
  audioEnabled: PropTypes.bool,
  videoEnabled: PropTypes.bool,
  floating: PropTypes.bool,
  onPipModeChange: PropTypes.func,
};

export default FallbackMeeting;
