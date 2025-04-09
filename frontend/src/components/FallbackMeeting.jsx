import React, { useEffect, useRef, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { toast } from 'react-toastify';
import './FallbackMeeting.css';
import config from '../environments';
import axios from 'axios';

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
  
  // Função para obter a URL da sala
  const getRoomUrl = useCallback(async () => {
    try {
      console.log('Verificando/criando sala:', roomName);
      
      // Importar as configurações
      const { SOCKET_URL } = await import('../config');
      
      // Usar URL completa do backend para evitar CORS e problemas de rota
      const apiUrl = `${SOCKET_URL}/api/meetings/validate-room/${roomName}`;
      console.log('Chamando API com URL completa:', apiUrl);
      
      // Verificar se a sala existe ou criar uma nova através do backend
      const response = await axios.get(apiUrl);
      
      console.log('Resposta da API de validação:', response.data);
      
      let baseUrl = null;
      
      // Verificar diferentes formatos possíveis de resposta
      if (response.data && response.data.url) {
        // Formato direto
        baseUrl = response.data.url;
      } else if (response.data && response.data.data && response.data.data.url) {
        // Formato aninhado
        baseUrl = response.data.data.url;
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
    } catch (err) {
      console.error('Erro ao validar sala no backend:', err);
      
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
        setIsLoading(true);
        
        // Obter URL da sala diretamente sem verificações
        const roomUrl = await getRoomUrl();
        
        // Configurar detalhes da sessão
        setSessionDetails({
          url: roomUrl,
          roomName,
          userName
        });
        
          setIsLoading(false);
      } catch (err) {
        console.error('Erro ao inicializar sessão:', err);
        setError('Não foi possível inicializar a sessão de vídeo. Por favor, recarregue a página.');
        setIsLoading(false);
      }
    };
    
    startSession();
  }, [roomName, userName, getRoomUrl]);
  
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
    <div className="fallback-meeting-container">
      <VideoErrorBoundary onReset={() => window.location.reload()}>
        <div className="video-container" ref={videoContainerRef}>
          {sessionDetails && (
            <DailyFrame 
              roomUrl={sessionDetails.url} 
              onLoad={handleIframeLoad}
            />
          )}
          
          {document.pictureInPictureEnabled && !floating && isVideoEnabled && (
            <button 
              onClick={handlePipClick}
              className="pip-button"
            >
              PiP
            </button>
          )}
        </div>
      </VideoErrorBoundary>
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
