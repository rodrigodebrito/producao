import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { getSessionById, markSessionCompleted } from '../services/sessionService';
import { AIProvider } from '../contexts/AIContext';
import AIToolsContainer from '../components/AIComponents';
import ConstellationField from '../components/ConstellationField/index';
import io from 'socket.io-client';
import { SOCKET_URL } from '../config';
import '../styles/SessionRoom.css';

const SessionRoom = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isPipMode, setIsPipMode] = useState(false);
  const [fullScreenElement, setFullScreenElement] = useState(null);
  const [showControls, setShowControls] = useState(true);
  const [dragStartPosition, setDragStartPosition] = useState({ x: 0, y: 0 });
  const [videoPosition, setVideoPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [canDrag, setCanDrag] = useState(false);
  const [isRoomMounted, setIsRoomMounted] = useState(false);
  const [showAITools, setShowAITools] = useState(true);
  const [showConstellation, setShowConstellation] = useState(false);
  const [socket, setSocket] = useState(null);
  
  const aiContainerRef = useRef(null);
  const constellationContainerRef = useRef(null);
  const sessionRoomRef = useRef(null);
  
  // Verificar se o container de AI está vazio após a montagem
  useEffect(() => {
    const checkIfAIContainerEmpty = () => {
      if (aiContainerRef.current) {
        const hasContent = aiContainerRef.current.querySelector('.persistent-ai-tools');
        if (!hasContent || (hasContent && !hasContent.childNodes.length)) {
          setShowAITools(false);
        } else {
          setShowAITools(true);
        }
      }
    };
    
    // Verificar inicialmente
    checkIfAIContainerEmpty();
    
    // Configurar um MutationObserver para monitorar mudanças no container
    const observer = new MutationObserver(checkIfAIContainerEmpty);
    
    if (aiContainerRef.current) {
      observer.observe(aiContainerRef.current, { 
        childList: true, 
        subtree: true 
      });
    }
    
    // Verificar novamente após alguns segundos para garantir
    const timer = setTimeout(checkIfAIContainerEmpty, 3000);
    
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [isRoomMounted]);

  // Inicializar o socket para comunicação
  useEffect(() => {
    try {
      // Verificar se já existe um socket global
      if (window.socket && window.socket.connected) {
        console.log('Usando socket global existente:', window.socket.id);
        setSocket(window.socket);
        return;
      }
      
      // Usar a URL do socket da configuração global
      const socketURL = SOCKET_URL;
      
      console.log(`🔌 Socket.IO: Iniciando conexão com ${socketURL}`);
      console.log(`🔌 Socket.IO: Configuração`, {
        transports: ['polling', 'websocket'],
        reconnection: true,
        reconnectionAttempts: 10,
        path: '/socket.io'
      });
      
      // Conectar ao servidor de sockets
      const socketInstance = io(socketURL, {
        transports: ['polling', 'websocket'], // Tente polling primeiro, depois websocket
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        timeout: 10000,
        forceNew: true,
        path: '/socket.io' // Caminho padrão para socket.io
      });
      
      // Monitor all socket events for debugging
      socketInstance.onAny((event, ...args) => {
        console.log(`🔌 Socket.IO: Evento recebido - "${event}"`, args);
      });
      
      // Configurar listeners de eventos do socket
      socketInstance.on('connect', () => {
        console.log(`✅ Socket.IO: Conectado com sucesso! ID: ${socketInstance.id}`);
        console.log(`📡 Socket.IO: URL do servidor: ${socketInstance.io.uri}`);
        console.log(`📡 Socket.IO: Transporte ativo: ${socketInstance.io.engine.transport.name}`);
        
        // Entrar na sala específica da sessão
        console.log(`🔑 Socket.IO: Entrando na sala da sessão ${sessionId}`);
        socketInstance.emit('join-session', { sessionId });
        
        toast.success('Conexão em tempo real estabelecida');
      });
      
      socketInstance.on('disconnect', (reason) => {
        console.log(`❌ Socket.IO: Desconectado - Motivo: ${reason}`);
        if (reason === 'io server disconnect') {
          // O servidor desconectou o cliente
          console.log(`🔄 Socket.IO: Tentando reconectar manualmente...`);
          socketInstance.connect();
        }
        // Se for io client disconnect, o próprio cliente desconectou
      });
      
      socketInstance.on('connect_error', (error) => {
        console.error(`❌ Socket.IO: Erro de conexão:`, error);
        console.log(`📝 Socket.IO: Detalhes - ${error.message}`);
        console.log(`🌐 Socket.IO: Tentando conectar a: ${socketURL}, Caminho: ${socketInstance.io.opts.path}`);
        toast.warning('Tentando estabelecer conexão em tempo real...');
      });
      
      socketInstance.on('connect_timeout', (timeout) => {
        console.error(`⏱️ Socket.IO: Timeout na conexão: ${timeout}ms`);
      });
      
      socketInstance.io.on('reconnect', (attempt) => {
        console.log(`🔄 Socket.IO: Reconectado após ${attempt} tentativas`);
        console.log(`🔑 Socket.IO: Reentrando na sala da sessão ${sessionId}`);
        socketInstance.emit('join-session', { sessionId });
      });
      
      socketInstance.io.on('reconnect_attempt', (attempt) => {
        console.log(`🔄 Socket.IO: Tentativa de reconexão #${attempt}`);
      });
      
      socketInstance.io.on('reconnect_error', (error) => {
        console.error(`❌ Socket.IO: Erro na reconexão:`, error);
      });
      
      socketInstance.io.on('reconnect_failed', () => {
        console.error(`❌ Socket.IO: Falha na reconexão após todas tentativas`);
        toast.error('Não foi possível reconectar ao servidor. Tente atualizar a página.');
      });
      
      // Armazenar a instância do socket no estado
      setSocket(socketInstance);
      
      // Disponibilizar o socket globalmente para outros componentes
      window.socket = socketInstance;
      
      // Também tornar explicitamente disponível para o componente de constelação
      window.constellationSocket = socketInstance;
      
      console.log('Socket inicializado e disponibilizado globalmente');
      
      // Adicionar evento para verificar desconexões
      window.addEventListener('online', () => {
        console.log('Conexão de rede disponível, verificando socket...');
        if (socketInstance && !socketInstance.connected) {
          console.log('Tentando reconectar socket após retorno da rede...');
          socketInstance.connect();
        }
      });
      
      // Desconectar socket ao desmontar o componente
      return () => {
        if (socketInstance) {
          socketInstance.disconnect();
        }
        // Limpar a referência global
        if (window.socket === socketInstance) {
          window.socket = null;
        }
        if (window.constellationSocket === socketInstance) {
          window.constellationSocket = null;
        }
      };
    } catch (error) {
      console.error('Erro ao inicializar socket:', error);
    }
  }, [sessionId]);

  // Melhorar a função handleToggleConstellation para usar websockets de forma segura
  const handleToggleConstellation = useCallback(() => {
    try {
      // Inverter o estado localmente
      setShowConstellation(prevState => {
        const newState = !prevState;
        
        // Salvar estado no localStorage
        try {
          localStorage.setItem('constellation-state', JSON.stringify({
            active: newState,
            sessionId,
            timestamp: Date.now()
          }));
        } catch (err) {
          console.error('Erro ao salvar estado no localStorage:', err);
        }
        
        // Disparar evento para sincronização local (outras abas)
        window.dispatchEvent(new CustomEvent(newState ? 'constellation-activated' : 'constellation-deactivated', {
          detail: {
            sessionId,
            timestamp: Date.now()
          }
        }));
        
        // Enviar mensagem via socket para sincronizar entre terapeuta e cliente
        if (socket && socket.connected) {
          console.log(`Enviando comando de constelação via socket: ${newState ? 'ativar' : 'desativar'}`);
          socket.emit('constellation-command', {
            type: newState ? 'activate' : 'deactivate',
            sessionId,
            timestamp: Date.now()
          });
        } else {
          console.log('Socket não disponível ou não conectado para enviar comando de constelação');
        }
        
        // Se ativado, adicionar classe ao body para identificar estado
        if (newState) {
          document.body.classList.add('constellation-active');
          // Adicionar classe ao container do vídeo para o modo PiP
          if (sessionRoomRef.current) {
            sessionRoomRef.current.classList.add('with-constellation');
          }
        } else {
          document.body.classList.remove('constellation-active');
          // Remover classe do container do vídeo
          if (sessionRoomRef.current) {
            sessionRoomRef.current.classList.remove('with-constellation');
          }
        }
        
        return newState;
      });
    } catch (error) {
      console.error('Erro ao alternar campo de constelação:', error);
      toast.error('Erro ao alternar o campo de constelação');
    }
  }, [sessionId, socket]);

  // Função para alternar visibilidade das ferramentas de IA
  const toggleAITools = useCallback(() => {
    setShowAITools(prev => !prev);
  }, []);

  // Adicionar listener para comandos de constelação via socket
  useEffect(() => {
    if (socket) {
      // Listener para comandos de constelação
      const handleConstellationCommand = (data) => {
        if (data && data.sessionId === sessionId) {
          console.log('Recebido comando de constelação via socket:', data);
          
          if (data.type === 'activate' && !showConstellation) {
            console.log('Ativando campo de constelação via comando remoto');
            setShowConstellation(true);
            
            // Adicionar classes visuais
            document.body.classList.add('constellation-active');
            if (sessionRoomRef.current) {
              sessionRoomRef.current.classList.add('with-constellation');
            }
            
            // Notificar o usuário
            toast.info('Campo de constelação ativado pelo outro participante');
          } 
          else if (data.type === 'deactivate' && showConstellation) {
            console.log('Desativando campo de constelação via comando remoto');
            setShowConstellation(false);
            
            // Remover classes visuais
            document.body.classList.remove('constellation-active');
            if (sessionRoomRef.current) {
              sessionRoomRef.current.classList.remove('with-constellation');
            }
            
            // Notificar o usuário
            toast.info('Campo de constelação desativado pelo outro participante');
          }
        }
      };

      // Registrar o listener
      socket.on('constellation-command', handleConstellationCommand);
      
      return () => {
        // Remover o listener quando o componente desmontar
        socket.off('constellation-command', handleConstellationCommand);
      };
    }
  }, [sessionId, socket, showConstellation]);

  // Adicionar listener para o evento toggle-constellation-field
  useEffect(() => {
    const handleToggleEvent = () => {
      handleToggleConstellation();
    };
    
    // Adicionar o listener para o evento
    window.addEventListener('toggle-constellation-field', handleToggleEvent);
    
    // Remover o listener quando o componente for desmontado
    return () => {
      window.removeEventListener('toggle-constellation-field', handleToggleEvent);
    };
  }, [handleToggleConstellation]);

  // Carregar dados da sessão
  useEffect(() => {
    const fetchSessionData = async () => {
      try {
        setLoading(true);
        const data = await getSessionById(sessionId);
        setSession(data);
        document.title = `${data.title || 'Sessão'} - TerapiaConect`;
        setError(null);
      } catch (err) {
        console.error('Erro ao carregar sessão:', err);
        // Em vez de apenas mostrar erro, criar uma sessão temporária para permitir a videochamada
        setSession({
          id: sessionId,
          title: 'Sessão Terapêutica',
          therapist: { name: 'Terapeuta' },
          isTemporary: true
        });
        setError('Usando modo temporário de videochamada');
        toast.warning('Usando modo temporário de videochamada');
      } finally {
        setLoading(false);
      }
    };

    if (sessionId) {
      fetchSessionData();
    }
  }, [sessionId]);

  // Monitorar mudanças no estado de tela cheia
  useEffect(() => {
    const handleFullScreenChange = () => {
      const isFullScreen = document.fullscreenElement !== null;
      setFullScreenElement(document.fullscreenElement);
      
      // Mostrar controles por alguns segundos ao entrar/sair da tela cheia
      setShowControls(true);
      setTimeout(() => {
        if (!isPipMode) {
          setShowControls(false);
        }
      }, 3000);
    };

    document.addEventListener('fullscreenchange', handleFullScreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullScreenChange);
    };
  }, [isPipMode]);

  // Gerenciar eventos de mouse para arrastar e redimensionar o vídeo
  useEffect(() => {
    // Só adicionar event listeners se estiver em modo PiP
    if (!isPipMode) return;

    const handleMouseMove = (e) => {
      if (isDragging && canDrag) {
        const deltaX = e.clientX - dragStartPosition.x;
        const deltaY = e.clientY - dragStartPosition.y;
        
        setVideoPosition(prev => ({
          x: prev.x + deltaX,
          y: prev.y + deltaY
        }));
        
        setDragStartPosition({
          x: e.clientX,
          y: e.clientY
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPipMode, isDragging, dragStartPosition, canDrag]);

  // Função para iniciar o arrasto do vídeo em modo PiP
  const handleMouseDown = (e) => {
    if (isPipMode && !isVideoResizing(e.target)) {
      setIsDragging(true);
      setDragStartPosition({
        x: e.clientX,
        y: e.clientY
      });
    }
  };

  // Verificar se estamos redimensionando o vídeo
  const isVideoResizing = (element) => {
    return element.classList && element.classList.contains('resizer');
  };

  // Alternar o modo PiP
  const handlePipModeChange = (enabled) => {
    setIsPipMode(enabled);
    setShowControls(!enabled);
  };

  // Sair da sessão
  const exitSession = async () => {
    try {
      // Atualizar status da sessão para concluída
      if (session && session.status === 'em_andamento') {
        await markSessionCompleted(sessionId);
      }
      navigate('/dashboard');
    } catch (error) {
      console.error('Erro ao sair da sessão:', error);
      toast.error('Erro ao finalizar a sessão');
      navigate('/dashboard');
    }
  };

  useEffect(() => {
    if (session && !isRoomMounted) {
      // Delay para garantir estabilidade antes de montar o componente
      const timer = setTimeout(() => {
        setIsRoomMounted(true);
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [session, isRoomMounted]);

  // Verificar se a sessão é virtual/emergência e adaptar a experiência
  const isVirtualSession = session?.isVirtual || session?.isEmergency || false;
  
  useEffect(() => {
    if (isVirtualSession) {
      // Log para depuração
      console.log('Sessão virtual detectada:', session);
      
      // Podemos configurar comportamentos específicos para sessão virtual
      toast.info('Você está em uma sala de sessão temporária. Algumas funcionalidades podem ser limitadas.');
      
      // Podemos simular carregamento mais rápido
      if (loading) {
        setLoading(false);
      }
    }
  }, [isVirtualSession, session, loading]);
  
  // Componente de sessão virtual para quando não temos dados reais
  const VirtualSessionFallback = () => {
    return (
      <div className="virtual-session-container">
        <div className="virtual-video-container">
          <div className="virtual-video-placeholder">
            <div className="virtual-video-message">
              <h3>Sala de Sessão Temporária</h3>
              <p>Esta é uma sala de sessão temporária onde você pode se conectar com o terapeuta.</p>
              <p>Em caso de problemas técnicos, entre em contato por outros meios.</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return <div className="loading-container">Carregando sessão...</div>;
  }

  // Componente restruturado para não mostrar o FallbackMeeting
  return (
    <AIProvider>
      <div className={`session-room ${showConstellation ? 'with-constellation' : ''}`} ref={sessionRoomRef}>
        {/* Removido o componente de videochamada aqui */}
        
        {/* Container do Campo de Constelação */}
        {showConstellation && (
          <div 
            id="constellation-container" 
            className="constellation-container visible"
            ref={constellationContainerRef}
          >
            <ConstellationField 
              sessionId={sessionId}
              isHost={session?.isTherapist}
              fieldTexture="/white-circle.png"
            />
          </div>
        )}
        
        {/* Botões de ferramentas */}
        <div className="session-tools-buttons">
          <button 
            className="tool-button constellation-button"
            onClick={handleToggleConstellation}
            title="Ativar/Desativar Campo de Constelação"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 17.27L18.18 21L16.54 13.97L22 9.24L14.81 8.63L12 2L9.19 8.63L2 9.24L7.46 13.97L5.82 21L12 17.27Z" fill="white"/>
            </svg>
          </button>
          
          <button 
            className="tool-button ai-toggle-button"
            onClick={toggleAITools}
            title={showAITools ? "Ocultar Ferramentas de IA" : "Mostrar Ferramentas de IA"}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z" fill="white"/>
            </svg>
          </button>
        </div>
        
        {/* Ferramentas de IA */}
        {showAITools && (
          <div id="direct-ai-buttons" className="ai-toolbar-container" ref={aiContainerRef}>
            <div className="ai-toolbar-wrapper">
              <AIToolsContainer />
            </div>
          </div>
        )}
      </div>
    </AIProvider>
  );
};

export default SessionRoom;