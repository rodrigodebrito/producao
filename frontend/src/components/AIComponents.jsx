import React, { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'react-toastify';
import { useAI } from '../contexts/AIContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faMicrophoneSlash, faFileAlt } from '@fortawesome/free-solid-svg-icons';
import hybridAIService from '../services/hybridAI.service';
import WhisperTranscriptionService from '../services/whisperTranscriptionService';
import AIResultsPanel from './AIResultsPanel';
import './AITools.css';
import ReactDOM from 'react-dom';
import webrtcTranscriptionService from '../services/webrtcTranscriptionService';

/**
 * Componentes de IA extraídos do FallbackMeeting
 * Agora podem ser usados em qualquer lugar da aplicação
 */

// Componente de seletor de modo de transcrição
export const TranscriptionSelector = ({ mode, onChange }) => {
  const handleChange = (e) => {
    const newMode = e.target.value;
    console.log(`TranscriptionSelector: Selecionando modo ${newMode}`);
    
    // Adicionar um pequeno atraso para que o usuário veja a seleção antes do feedback
    setTimeout(() => {
      onChange(newMode);
    }, 100);
  };
  
  // Opções disponíveis e seus rótulos
  const options = [
    { value: 'webrtc', label: 'WebRTC (Recomendado)' },
    { value: 'auto', label: 'Auto' },
    { value: 'whisper', label: 'Whisper (Alta precisão)' },
    { value: 'webspeech', label: 'Browser (Tempo real)' }
  ];
  
  return (
    <div className="transcription-mode-selector">
      <label className="transcription-mode-label">Modo de transcrição: </label>
      <select
        value={mode}
        onChange={handleChange}
        className={`transcription-mode-select transcription-mode-${mode}`}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      
      <div className="transcription-mode-indicator">
        Modo atual: <span className={`mode-${mode}`}>
          {mode === 'webrtc' ? 'WebRTC (Recomendado)' :
           mode === 'auto' ? 'Auto' : 
           mode === 'whisper' ? 'Whisper (Alta precisão)' : 
           'Browser (Tempo real)'}
        </span>
      </div>
    </div>
  );
};

// Componente de botão do microfone
export const MicButton = ({ transcriptionMode = 'auto' }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [currentMode, setCurrentMode] = useState(transcriptionMode);
  const [captureMode, setCaptureMode] = useState('mic'); // 'mic' ou 'system'
  const [isRequesting, setIsRequesting] = useState(false);
  const recordingTimerRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const selectedModeRef = useRef(transcriptionMode);
  
  // Função para alternar entre modos de captura (microfone vs. sistema)
  const toggleCaptureMode = useCallback(() => {
    if (isRecording) return; // Não permitir alteração durante gravação
    
    const newMode = captureMode === 'mic' ? 'system' : 'mic';
    setCaptureMode(newMode);
    console.log(`Modo de captura alterado para: ${newMode}`);
    
    // Mostrar toast para feedback ao usuário
    toast.info(`Modo de captura alterado: ${newMode === 'mic' ? 'Apenas Microfone' : 'Microfone + Áudio da Chamada'}`);
  }, [captureMode, isRecording]);
  
  // Função para parar todas as gravações ativas
  const stopAllRecordings = useCallback(() => {
    console.log('🛑 Parando todos os serviços de gravação');
    
    if (window.hybridAIService) {
      try {
        console.log('🛑 Parando serviço Web Speech API');
        window.hybridAIService.stopRecording();
      } catch (e) {
        console.error('❌ Erro ao parar hybridAIService:', e);
      }
    }
    
    if (window.whisperService) {
      try {
        console.log('🛑 Parando serviço Whisper');
        window.whisperService.stopRecording();
      } catch (e) {
        console.error('❌ Erro ao parar whisperService:', e);
      }
    }
    
    // Se estiver no modo de captura do sistema, parar captura de áudio do sistema
    if (captureMode === 'system' && window.systemAudioCaptureService) {
      try {
        console.log('🛑 Parando serviço de captura de áudio do sistema');
        window.systemAudioCaptureService.stopCapture();
      } catch (e) {
        console.error('❌ Erro ao parar systemAudioCaptureService:', e);
      }
    }
  }, [captureMode]);
  
  // Função de iniciar gravação com um modo específico
  const startRecordingWithMode = useCallback((mode) => {
    const effectiveMode = mode || selectedModeRef.current || currentMode || 'auto';
    console.log(`▶️ Iniciando gravação no modo: ${effectiveMode}`);
    
    // Limpar qualquer timeout anterior
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }
    
    // Verificar modo de captura (mic ou system)
    if (captureMode === 'system') {
      console.log('Iniciando captura com áudio do sistema + microfone');
      
      // Iniciar captura combinada usando systemAudioCaptureService
      if (window.systemAudioCaptureService) {
        try {
          window.systemAudioCaptureService.startCapture().then(success => {
            if (success) {
              setIsRecording(true);
              toast.info('Gravação de áudio do sistema iniciada');
            } else {
              toast.error('Falha ao iniciar captura de áudio do sistema');
            }
          });
          
          return true;
        } catch (e) {
          console.error('Erro ao iniciar captura de áudio do sistema:', e);
          toast.error('Erro ao acessar áudio do sistema');
          return false;
        }
      } else {
        // Se o serviço não está disponível, tentar criá-lo
        console.log('Serviço de captura de áudio do sistema não disponível, tentando criar...');
        
        // Importar o serviço dinamicamente
        import('../services/systemAudioCapture.service').then(module => {
          window.systemAudioCaptureService = module.default;
          
          // Tentar iniciar novamente
          window.systemAudioCaptureService.startCapture().then(success => {
            if (success) {
              setIsRecording(true);
              toast.info('Gravação de áudio do sistema iniciada');
            } else {
              toast.error('Falha ao iniciar captura de áudio do sistema');
            }
          });
        }).catch(err => {
          console.error('Erro ao importar systemAudioCaptureService:', err);
          toast.error('Não foi possível carregar o serviço de captura de áudio');
          
          // Fallback para o modo de microfone
          setCaptureMode('mic');
          return false;
        });
      }
    }
    
    // Continuar com o fluxo normal para mic
    if (effectiveMode === 'whisper') {
      if (window.whisperService) {
        console.log('▶️ Iniciando APENAS o serviço Whisper');
        console.log('⚠️ Serviço Web Speech será ignorado neste modo');
        window.whisperService.startRecording();
        setIsRecording(true);
        toast.info('Reconhecimento Whisper iniciado');
        return true;
      } else {
        console.error('❌ Serviço Whisper não disponível');
        toast.error('Serviço Whisper não disponível');
        return false;
      }
    } 
    else if (effectiveMode === 'webspeech') {
      if (window.hybridAIService) {
        console.log('▶️ Iniciando APENAS o serviço Web Speech API');
        console.log('⚠️ Serviço Whisper será ignorado neste modo');
        window.hybridAIService.startRecording();
        setIsRecording(true);
        toast.info('Reconhecimento Web Speech iniciado');
        return true;
      } else {
        console.error('❌ Serviço Web Speech não disponível');
        toast.error('Serviço Web Speech não disponível');
        return false;
      }
    } 
    else { // auto mode
      console.log('▶️ Modo AUTO: Iniciando ambos os serviços de transcrição');
      let started = false;
      
      if (window.whisperService) {
        console.log('▶️ Iniciando serviço Whisper (parte do modo Auto)');
        window.whisperService.startRecording();
        started = true;
      }
      
      if (window.hybridAIService) {
        console.log('▶️ Iniciando serviço Web Speech (parte do modo Auto)');
        window.hybridAIService.startRecording();
        started = true;
      }
      
      if (started) {
        setIsRecording(true);
        toast.info('Reconhecimento híbrido iniciado');
        return true;
      } else {
        toast.error('Nenhum serviço de reconhecimento disponível');
        return false;
      }
    }
  }, [currentMode, captureMode]);
  
  // Função para reiniciar gravação
  const restartRecording = useCallback(() => {
    try {
      // Primeiro parar tudo
      stopAllRecordings();
      setIsRecording(false);
      
      // Esperar um momento antes de iniciar novamente
      setTimeout(() => {
        const success = startRecordingWithMode();
        if (!success) {
          console.error('❌ Falha ao reiniciar gravação');
          setIsRecording(false);
        }
      }, 500);
    } catch (e) {
      console.error('❌ Erro ao reiniciar gravação:', e);
      setIsRecording(false);
    }
  }, [stopAllRecordings, startRecordingWithMode]);
  
  // Alternar entre gravar e parar
  const toggleMicrophone = useCallback(() => {
    try {
      if (isRecording) {
        // Parar gravação
        console.log('🛑 Parando gravação de voz');
        stopAllRecordings();
        setIsRecording(false);
        toast.info('Reconhecimento de voz parado');
      } else {
        // Iniciar gravação
        startRecordingWithMode();
      }
    } catch (error) {
      console.error('❌ Erro ao alternar microfone:', error);
      toast.error('Erro ao controlar reconhecimento de voz');
    }
  }, [isRecording, stopAllRecordings, startRecordingWithMode]);
  
  // Nova função para solicitar transcrição parcial
  const requestPartialTranscription = async () => {
    if (!isRecording) {
      console.log('MicButton: Não é possível solicitar transcrição parcial (não está gravando)');
      return;
    }

    try {
      setIsRequesting(true);
      console.log('MicButton: Solicitando transcrição parcial');
      
      // Solicitar transcrição via WebRTC se estiver disponível
      if (window.webrtcTranscriptionService && currentMode === 'webrtc') {
        const result = await window.webrtcTranscriptionService.transcribeCurrentAudio();
        
        if (result && result.transcription) {
          console.log('MicButton: Transcrição parcial recebida:', result.transcription);
          toast.success('Transcrição parcial recebida');
        } else {
          console.warn('MicButton: Nenhuma transcrição parcial recebida');
          toast.warning('Não foi possível obter transcrição parcial');
        }
      } 
      // Tentar solicitar transcrição via Whisper
      else if (window.whisperService && (currentMode === 'whisper' || currentMode === 'auto')) {
        // Simular uma transcrição parcial solicitando o fim da gravação atual
        // e reiniciando uma nova sem interromper a interface
        try {
          const currentAudio = window.whisperService.getCurrentAudio();
          if (currentAudio) {
            // Processar o áudio atual para transcrição
            window.whisperService.processAudioChunk(currentAudio, true);
            toast.info('Processando transcrição parcial...');
          } else {
            toast.warning('Sem áudio disponível para transcrição parcial');
          }
        } catch (e) {
          console.error('Erro ao solicitar transcrição parcial via Whisper:', e);
          toast.error('Erro ao processar transcrição parcial');
        }
      } else {
        toast.warning('Transcrição parcial não disponível no modo atual');
      }
    } catch (error) {
      console.error('MicButton: Erro ao solicitar transcrição parcial:', error);
      toast.error('Erro ao solicitar transcrição parcial');
    } finally {
      setIsRequesting(false);
    }
  };
  
  // Inicializar os serviços de transcrição
  useEffect(() => {
    // Verificar se os serviços já foram inicializados globalmente
    if (!window.hybridAIService) {
      console.log('🔧 Inicializando serviço Web Speech API');
      window.hybridAIService = hybridAIService;
    }
    
    if (!window.whisperService) {
      console.log('🔧 Inicializando serviço Whisper');
      window.whisperService = WhisperTranscriptionService;
    }
    
    // Carregar modo da variável global ou localStorage
    const getInitialMode = () => {
      // Primeiro tentar da variável global
      if (window.currentTranscriptionMode && 
          ['auto', 'whisper', 'webspeech'].includes(window.currentTranscriptionMode)) {
        console.log(`🎛️ MicButton sincronizando com modo global: ${window.currentTranscriptionMode}`);
        return window.currentTranscriptionMode;
      }
      
      // Senão, tentar da localStorage
      try {
        const savedMode = localStorage.getItem('transcription-mode');
        if (savedMode && ['auto', 'whisper', 'webspeech'].includes(savedMode)) {
          console.log(`🎛️ MicButton carregando modo da localStorage: ${savedMode}`);
          return savedMode;
        }
      } catch (e) {
        console.error('❌ Erro ao carregar modo da localStorage:', e);
      }
      
      // Fallback para o modo prop (ou 'auto' se não definido)
      return transcriptionMode || 'auto';
    };
    
    const initialMode = getInitialMode();
    setCurrentMode(initialMode);
    selectedModeRef.current = initialMode;
    
    // Limpar ao desmontar
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
      }
      
      // Garantir que a gravação seja interrompida ao desmontar
      if (isRecording) {
        stopAllRecordings();
      }
    };
  }, []); // Empty dependency array = only run once on mount
  
  // Escutar por mudanças de modo via eventos
  useEffect(() => {
    const handleModeChange = (event) => {
      if (event && event.detail && event.detail.mode) {
        const newMode = event.detail.mode;
        console.log(`🎧 MicButton recebeu evento de mudança de modo: ${newMode}`);
        
        if (newMode !== currentMode) {
          setCurrentMode(newMode);
          selectedModeRef.current = newMode;
          
          // Se estiver gravando, parar e reiniciar com o novo modo
          if (isRecording) {
            console.log('🔄 Reiniciando gravação devido a mudança de modo via evento');
            stopAllRecordings();
            
            // Pequeno delay antes de reiniciar
            setTimeout(() => {
              startRecordingWithMode(newMode);
            }, 500);
          }
        }
      }
    };
    
    window.addEventListener('transcription-mode-changed', handleModeChange);
    
    return () => {
      window.removeEventListener('transcription-mode-changed', handleModeChange);
    };
  }, [currentMode, isRecording, stopAllRecordings, startRecordingWithMode]);
  
  // Atualizar o modo quando a prop transcriptionMode mudar
  useEffect(() => {
    if (transcriptionMode !== currentMode) {
      console.log(`🔄 MicButton: Modo alterado via prop de ${currentMode} para ${transcriptionMode}`);
      setCurrentMode(transcriptionMode);
      selectedModeRef.current = transcriptionMode;
      
      // Se estiver gravando, atualizar o modo em uso
      if (isRecording) {
        console.log('🔄 Reiniciando gravação para aplicar novo modo');
        stopAllRecordings();
        
        setTimeout(() => {
          startRecordingWithMode(transcriptionMode);
        }, 500);
      }
    }
  }, [transcriptionMode, currentMode, isRecording, stopAllRecordings, startRecordingWithMode]);
  
  // Renderização do ícone do microfone
  const renderIcon = () => {
    return <FontAwesomeIcon 
      icon={isRecording ? faMicrophoneSlash : faMicrophone} 
      className="mic-icon" 
    />;
  };
  
  // Componente renderizado dentro do MicButton 
  return (
    <div className="mic-button-wrapper">
      <div className="capture-mode-selector">
        <button 
          onClick={toggleCaptureMode}
          className={`mode-selector-button ${captureMode === 'system' ? 'system-mode' : 'mic-mode'} ${isRecording ? 'disabled' : ''}`}
          disabled={isRecording}
          title={captureMode === 'mic' ? 'Capturar áudio do microfone e da chamada' : 'Capturar apenas o microfone'}
        >
          {captureMode === 'mic' ? (
            <>
              <span className="icon">🎙️</span>
              <span className="text">Apenas Microfone</span>
            </>
          ) : (
            <>
              <span className="icon">🔊</span>
              <span className="text">Microfone + Chamada</span>
            </>
          )}
        </button>
      </div>
      
      <div className="mic-controls">
        <button 
          onClick={() => {
            console.log("Clique no botão de gravação");
            // Verificar se existe o serviço de WebRTC
            if (window.webrtcTranscriptionService) {
              console.log("Usando serviço WebRTC");
              try {
                // Verificar se está gravando
                const status = window.webrtcTranscriptionService.getStatus();
                console.log("Status do WebRTC:", status);
                
                // Verificar se o serviço está inicializado
                if (!status.isInitialized) {
                  console.log("WebRTC não inicializado, inicializando agora...");
                  
                  // Detectar o sessionId
                  const sessionId = window.sessionId || 
                                   new URLSearchParams(window.location.search).get('sessionId') || 
                                   window.location.pathname.split('/').pop();
                                   
                  if (sessionId) {
                    const socket = window.socket || window.constellationSocket;
                    if (socket) {
                      toast.info("Inicializando serviço de transcrição...");
                      
                      window.webrtcTranscriptionService.initialize(sessionId, socket, (transcription, options = {}) => {
                        console.log('Transcrição recebida:', transcription);
                        if (options && options.isPartial) {
                          toast.success('Transcrição parcial recebida');
                        } else {
                          toast.success('Transcrição completa recebida');
                        }
                      }).then(success => {
                        if (success) {
                          console.log("WebRTC inicializado com sucesso, iniciando gravação...");
                          // Iniciar gravação após inicialização bem-sucedida
                          window.webrtcTranscriptionService.startRecording()
                            .then((startSuccess) => {
                              if (startSuccess) {
                                setIsRecording(true);
                                toast.success("Gravação iniciada");
                              } else {
                                toast.error("Falha ao iniciar gravação");
                              }
                            });
                        } else {
                          toast.error("Falha ao inicializar WebRTC");
                        }
                      });
                      return; // Sair da função para evitar o código abaixo
                    } else {
                      toast.error("Socket não disponível");
                    }
                  } else {
                    toast.error("ID de sessão não disponível");
                  }
                }
                
                if (status && status.isRecording) {
                  // Parar gravação
                  console.log("Parando gravação WebRTC");
                  window.webrtcTranscriptionService.stopRecording()
                    .then(() => {
                      setIsRecording(false);
                      toast.info("Gravação parada");
                    });
                } else {
                  // Iniciar gravação
                  console.log("Iniciando gravação WebRTC");
                  window.webrtcTranscriptionService.startRecording()
                    .then((success) => {
                      if (success) {
                        setIsRecording(true);
                        toast.info("Gravação iniciada");
                      } else {
                        toast.error("Falha ao iniciar gravação");
                      }
                    });
                }
              } catch (error) {
                console.error("Erro ao controlar WebRTC:", error);
                toast.error("Erro ao controlar gravação");
              }
            } else if (window.hybridAIService) {
              console.log("Usando serviço HybridAI");
              try {
                if (window.hybridAIService.isRecording) {
                  window.hybridAIService.stopRecording();
                  setIsRecording(false);
                  toast.info("Gravação parada");
                } else {
                  window.hybridAIService.startRecording();
                  setIsRecording(true);
                  toast.info("Gravação iniciada");
                }
              } catch (error) {
                console.error("Erro ao controlar HybridAI:", error);
                toast.error("Erro ao controlar gravação");
              }
            } else {
              console.error("Nenhum serviço de gravação disponível");
              toast.error("Nenhum serviço de gravação disponível");
            }
          }}
          className={`mic-button ${isRecording ? 'recording' : ''}`}
          title="Iniciar/Parar gravação"
        >
          <FontAwesomeIcon icon={isRecording ? faMicrophoneSlash : faMicrophone} />
        </button>
        
        {isRecording && currentMode === 'webrtc' && (
          <button 
            onClick={requestPartialTranscription}
            className={`transcribe-now-button ${isRequesting ? 'requesting' : ''}`}
            disabled={isRequesting || !isRecording}
            title="Solicitar transcrição do áudio gravado até o momento"
          >
            <FontAwesomeIcon icon={faFileAlt} />
            <span className="button-text">{isRequesting ? 'Processando...' : 'Transcrever Agora'}</span>
          </button>
        )}
      </div>
      
      {isRecording && (
        <div className="recording-info">
          <div className="recording-status">
            {captureMode === 'system' ? 'Gravando Microfone + Chamada' : 'Gravando Microfone'}
          </div>
        </div>
      )}
    </div>
  );
};

// Componente para mostrar status da transcrição contínua
export const TranscriptionStatus = () => {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [processingChunk, setProcessingChunk] = useState(false);
  const [chunkStats, setChunkStats] = useState({ count: 0, totalDuration: 0 });
  
  // useEffect para lidar com eventos de transcrição
  useEffect(() => {
    // Handler para procesamento de chunks
    const handleChunkProcessing = (event) => {
      if (event && event.detail) {
        setProcessingChunk(true);
        setIsTranscribing(true);
        const { chunkNumber, duration } = event.detail;
        console.log(`Processando chunk #${chunkNumber}, duração: ${Math.round(duration/1000)}s`);
      }
    };
    
    // Handler para quando um chunk é salvo
    const handleTranscriptionSaved = (event) => {
      if (event && event.detail) {
        setProcessingChunk(false);
        setIsTranscribing(true);
        const { historyLength, text } = event.detail;
        
        setChunkStats(prev => ({
          count: historyLength || prev.count + 1,
          totalDuration: prev.totalDuration + (event.detail.duration || 0)
        }));
        
        // Notificar usuário discretamente 
        toast.success(`Transcrição contínua #${historyLength} salva`, { 
          autoClose: 1500,
          position: 'bottom-right'
        });
      }
    };
    
    // Registrar event listeners
    document.addEventListener('whisper:processingChunk', handleChunkProcessing);
    document.addEventListener('whisper-processingChunk', handleChunkProcessing);
    document.addEventListener('whisper:transcriptionSaved', handleTranscriptionSaved);
    document.addEventListener('whisper-transcriptionSaved', handleTranscriptionSaved);
    
    // Limpar event listeners
    return () => {
      document.removeEventListener('whisper:processingChunk', handleChunkProcessing);
      document.removeEventListener('whisper-processingChunk', handleChunkProcessing);
      document.removeEventListener('whisper:transcriptionSaved', handleTranscriptionSaved);
      document.removeEventListener('whisper-transcriptionSaved', handleTranscriptionSaved);
    };
  }, []);
  
  if (!isTranscribing) return null;
  
  return (
    <div className="transcription-status">
      <div className={`status-indicator ${processingChunk ? 'processing' : 'recording'}`}></div>
      <div className="status-text">
        {processingChunk 
          ? 'Processando chunk de áudio...' 
          : 'Gravando áudio...'}
      </div>
      {chunkStats.count > 0 && (
        <div className="chunk-stats">
          {chunkStats.count} chunk{chunkStats.count !== 1 ? 's' : ''} processado{chunkStats.count !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

// Botões de IA completos
export const AIButtons = () => {
  const { analyze, suggest, report } = useAI();
  const [transcriptionMode, setTranscriptionMode] = useState('auto');

  const handleAnalyze = useCallback(() => {
    analyze().then(result => {
      console.log('Análise concluída:', result);
      toast.success('Análise concluída com sucesso');
    }).catch(error => {
      console.error('Erro na análise:', error);
      toast.error('Erro ao realizar análise');
    });
  }, [analyze]);

  const handleSuggest = useCallback(() => {
    suggest().then(result => {
      console.log('Sugestões geradas:', result);
      toast.success('Sugestões geradas com sucesso');
    }).catch(error => {
      console.error('Erro ao gerar sugestões:', error);
      toast.error('Erro ao gerar sugestões');
    });
  }, [suggest]);

  const handleReport = useCallback(() => {
    report().then(result => {
      console.log('Relatório gerado:', result);
      toast.success('Relatório gerado com sucesso');
    }).catch(error => {
      console.error('Erro ao gerar relatório:', error);
      toast.error('Erro ao gerar relatório');
    });
  }, [report]);
  
  // Função para o botão de Constelação que ativa o campo no SessionRoom
  const handleConstellation = useCallback(() => {
    try {
      // Disparar evento personalizado para ativar o campo
      window.dispatchEvent(new CustomEvent('toggle-constellation-field'));
      console.log('Evento toggle-constellation-field disparado');
    } catch (error) {
      console.error('Erro ao ativar campo de constelação:', error);
      toast.error('Erro ao ativar campo de constelação');
    }
  }, []);

  return (
    <div className="ai-buttons-container">
      <MicButton />
      
      <div className="transcription-controls">
        <div className="transcription-label">Modo de transcrição:</div>
        <select
          value={transcriptionMode}
          onChange={(e) => setTranscriptionMode(e.target.value)}
          className="transcription-select"
        >
          <option value="auto">Auto</option>
          <option value="whisper">Whisper (Alta precisão)</option>
          <option value="webspeech">Browser (Tempo real)</option>
        </select>
      </div>
      
      <button 
        onClick={handleAnalyze}
        className="ai-button analyze-button"
        title="Analisar conversa atual"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z" fill="white"/>
        </svg>
        <span className="button-text">Analisar</span>
      </button>
      
      <button 
        onClick={handleSuggest}
        className="ai-button suggest-button"
        title="Obter sugestões"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20ZM11 16H13V18H11ZM12.61 6.04C10.55 5.79 8.73 7.13 8.27 9.17C8.05 10.3 9.03 10.99 10.1 10.68C10.65 10.5 11.25 10.07 11.36 9.5C11.78 7.83 14.08 8.2 14.08 10.25C14.08 11.28 13.47 11.8 12.69 12.5C11.91 13.2 11 14.09 11 15.25V15.5H13V15.25C13 14.58 13.67 14.11 14.45 13.41C15.23 12.71 16 11.8 16 10.25C16 7.92 14.57 6.29 12.61 6.04Z" fill="white"/>
        </svg>
        <span className="button-text">Sugestões</span>
      </button>
      
      <button 
        onClick={handleReport}
        className="ai-button report-button"
        title="Gerar relatório"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2ZM18 20H6V4H13V9H18V20ZM8 14H16V16H8V14ZM8 18H13V20H8V18ZM8 10H16V12H8V10Z" fill="white"/>
        </svg>
        <span className="button-text">Relatório</span>
      </button>
      
      <button 
        onClick={handleConstellation}
        className="ai-button constellation-button"
        title="Campo de Constelação"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 17.27L18.18 21L16.54 13.97L22 9.24L14.81 8.63L12 2L9.19 8.63L2 9.24L7.46 13.97L5.82 21L12 17.27Z" fill="white"/>
        </svg>
        <span className="button-text">Campo</span>
      </button>
    </div>
  );
};

// Função para reiniciar serviços de transcrição se necessário (desativada)
export const resetTranscriptionServices = () => {
  // Função desativada para evitar problemas de layout
  console.log('Função resetTranscriptionServices foi desativada');
  return; // Não execute nada

  /*
  try {
    console.log('Tentando reiniciar serviços de transcrição');
    
    // Limpar referências existentes
    if (window.hybridAIService) {
      try {
        window.hybridAIService.stopRecording();
      } catch (e) {
        console.error('Erro ao parar hybridAIService:', e);
      }
    }
    
    if (window.whisperService) {
      try {
        window.whisperService.stopRecording();
      } catch (e) {
        console.error('Erro ao parar whisperService:', e);
      }
    }
    
    // Pequena pausa para garantir limpeza
    setTimeout(() => {
      // Reiniciar serviços
      window.hybridAIService = hybridAIService;
      window.whisperService = new WhisperTranscriptionService();
      
      toast.info('Serviços de transcrição reiniciados');
      console.log('Serviços de transcrição reiniciados com sucesso');
    }, 1000);
  } catch (error) {
    console.error('Erro ao reiniciar serviços de transcrição:', error);
    toast.error('Falha ao reiniciar serviços. Tente recarregar a página.');
  }
  */
};

// Componente principal que contém todas as ferramentas de IA
export const AIToolsContainer = () => {
  const [transcriptionMode, setTranscriptionMode] = useState('webrtc');
  const [isRecording, setIsRecording] = useState(false);
  const containerRef = useRef(null);
  const previousModeRef = useRef('webrtc');
  
  // Obter funções de IA do contexto para que possam ser passadas aos botões
  const { analyze, suggest, report } = useAI();

  // Inicializar o serviço WebRTC uma vez quando o componente for montado
  useEffect(() => {
    // Garantir que o serviço WebRTC esteja disponível globalmente
    if (!window.webrtcTranscriptionService) {
      console.log('Inicializando serviço WebRTC...');
      window.webrtcTranscriptionService = webrtcTranscriptionService;
      
      // Detectar o sessionId
      const sessionId = window.sessionId || 
                        new URLSearchParams(window.location.search).get('sessionId') || 
                        window.location.pathname.split('/').pop();
      
      if (sessionId) {
        console.log(`Inicializando WebRTC para a sessão: ${sessionId}`);
        // Inicializar com o socket global (se disponível)
        const socket = window.socket || window.constellationSocket;
        
        if (socket) {
          webrtcTranscriptionService.initialize(sessionId, socket, (transcription, options = {}) => {
            console.log('Transcrição recebida:', transcription);
            // Fornecer feedback com base no tipo de transcrição
            if (options && options.isPartial) {
              toast.success('Transcrição parcial recebida');
            } else {
              toast.success('Transcrição completa recebida');
            }
          }).then(success => {
            console.log(`Serviço WebRTC inicializado com sucesso: ${success}`);
            if (success) {
              // Definir webrtc como modo padrão
              handleTranscriptionModeChange('webrtc');
            }
          }).catch(error => {
            console.error('Erro ao inicializar WebRTC:', error);
            toast.error('Erro ao inicializar WebRTC. Tentando modo alternativo.');
          });
        } else {
          console.warn('Socket não disponível, WebRTC pode não funcionar corretamente');
          toast.warning('Socket não disponível. Alguns recursos podem não funcionar.');
        }
      }
    } else {
      console.log('Serviço WebRTC já inicializado, verificando status...');
      const status = window.webrtcTranscriptionService.getStatus();
      console.log('Status atual do WebRTC:', status);
      
      // Se o serviço não estiver inicializado, tentar novamente
      if (!status.isInitialized) {
        console.log('WebRTC não inicializado corretamente, tentando reiniciar...');
        // Detectar o sessionId
        const sessionId = window.sessionId || 
                          new URLSearchParams(window.location.search).get('sessionId') || 
                          window.location.pathname.split('/').pop();
                            
        if (sessionId) {
          const socket = window.socket || window.constellationSocket;
          if (socket) {
            webrtcTranscriptionService.initialize(sessionId, socket, (transcription, options = {}) => {
              console.log('Transcrição recebida:', transcription);
              if (options && options.isPartial) {
                toast.success('Transcrição parcial recebida');
              } else {
                toast.success('Transcrição completa recebida');
              }
            });
          }
        }
      }
    }
  }, []);

  // Verificar periodicamente o status da gravação para atualizar a interface
  useEffect(() => {
    const checkRecordingStatus = () => {
      try {
        const webrtcService = window.webrtcTranscriptionService;
        const webrtcRecording = webrtcService && webrtcService.getStatus().isRecording;
        const hybridRecording = window.hybridAIService?.isRecording || false;
        const newIsRecording = webrtcRecording || hybridRecording;
        
        if (newIsRecording !== isRecording) {
          console.log(`Status de gravação alterado para: ${newIsRecording ? 'GRAVANDO' : 'PARADO'}`);
          setIsRecording(newIsRecording);
        }
      } catch (error) {
        console.error('Erro ao verificar status de gravação:', error);
      }
    };
    
    // Verificar a cada 500ms
    const interval = setInterval(checkRecordingStatus, 500);
    
    return () => {
      clearInterval(interval);
    };
  }, [isRecording]);

  // Verificar se container existe e criar se necessário
  useEffect(() => {
    // Criar um container persistente para os botões de IA se ainda não existir
    if (!document.getElementById('persistent-ai-tools')) {
      const persistentContainer = document.createElement('div');
      persistentContainer.id = 'persistent-ai-tools';
      persistentContainer.className = 'persistent-ai-tools ai-tools-container-direct';
      document.body.appendChild(persistentContainer);
      containerRef.current = persistentContainer;
      console.log('Criado container persistente para AI Tools');
    } else {
      containerRef.current = document.getElementById('persistent-ai-tools');
      console.log('Usando container de AI existente');
    }

    // Verificar periodicamente se o container ainda existe
    const interval = setInterval(() => {
      if (!document.getElementById('persistent-ai-tools')) {
        console.log('Container de AI foi removido, recriando...');
        const newContainer = document.createElement('div');
        newContainer.id = 'persistent-ai-tools';
        newContainer.className = 'persistent-ai-tools ai-tools-container-direct';
        document.body.appendChild(newContainer);
        containerRef.current = newContainer;
      }
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  // Handlers para os botões
  const handleAnalyze = useCallback(() => {
    analyze().then(result => {
      console.log('Análise concluída:', result);
      toast.success('Análise concluída com sucesso');
    }).catch(error => {
      console.error('Erro na análise:', error);
      toast.error('Erro ao realizar análise');
    });
  }, [analyze]);

  const handleSuggest = useCallback(() => {
    suggest().then(result => {
      console.log('Sugestões geradas:', result);
      toast.success('Sugestões geradas com sucesso');
    }).catch(error => {
      console.error('Erro ao gerar sugestões:', error);
      toast.error('Erro ao gerar sugestões');
    });
  }, [suggest]);

  const handleReport = useCallback(() => {
    report().then(result => {
      console.log('Relatório gerado:', result);
      toast.success('Relatório gerado com sucesso');
    }).catch(error => {
      console.error('Erro ao gerar relatório:', error);
      toast.error('Erro ao gerar relatório');
    });
  }, [report]);

  // Função específica para mudar o modo de transcrição, atualizada
  const handleTranscriptionModeChange = useCallback((newMode) => {
    console.log(`🎚️ Alterando modo de transcrição de ${transcriptionMode} para ${newMode}`);
    
    // Garantir que é um modo válido
    if (!['auto', 'whisper', 'webspeech', 'webrtc'].includes(newMode)) {
      console.error(`❌ Modo inválido: ${newMode}, usando 'webrtc' como fallback`);
      newMode = 'webrtc';
    }
    
    // Atualizar estado local
    setTranscriptionMode(newMode);
    previousModeRef.current = newMode;
    
    // Definir variável global para compatibilidade entre componentes
    try {
      window.currentTranscriptionMode = newMode;
      console.log(`🌐 Modo de transcrição global definido como: ${newMode}`);
    } catch (e) {
      console.error('❌ Erro ao definir variável global:', e);
    }
    
    // Parar qualquer gravação ativa antes de mudar o modo
    if (window.hybridAIService && window.hybridAIService.isRecording) {
      console.log('🛑 Parando gravação do Web Speech para aplicar novo modo');
      try {
        window.hybridAIService.stopRecording();
      } catch (e) {
        console.error('❌ Erro ao parar hybridAIService:', e);
      }
    }
    
    if (window.whisperService && window.whisperService.isRecording) {
      console.log('🛑 Parando gravação do Whisper para aplicar novo modo');
      try {
        window.whisperService.stopRecording();
      } catch (e) {
        console.error('❌ Erro ao parar whisperService:', e);
      }
    }
    
    // Salvar na localStorage para manter a configuração entre sessões
    try {
      localStorage.setItem('transcription-mode', newMode);
      console.log(`💾 Modo de transcrição '${newMode}' salvo na localStorage`);
    } catch (e) {
      console.error('❌ Erro ao salvar modo de transcrição:', e);
    }
    
    // Disparar evento personalizado para que outros componentes sejam notificados
    window.dispatchEvent(new CustomEvent('transcription-mode-changed', { 
      detail: { mode: newMode, timestamp: Date.now() }
    }));
    console.log(`📢 Evento 'transcription-mode-changed' disparado com modo: ${newMode}`);
    
    // Notificar usuário sobre a mudança
    toast.info(`Modo de transcrição alterado para: ${
      newMode === 'auto' ? 'Auto (ambos serviços)' : 
      newMode === 'whisper' ? 'Whisper (Alta precisão)' : 
      newMode === 'webspeech' ? 'Browser (Tempo real)' : 'WebRTC'
    }`);
    
    return newMode;
  }, [transcriptionMode]);

  // Carregar configuração salva na inicialização
  useEffect(() => {
    try {
      // Definir webrtc como padrão
      const defaultMode = 'webrtc';
      const savedMode = localStorage.getItem('transcription-mode');
      
      if (savedMode && ['auto', 'whisper', 'webspeech', 'webrtc'].includes(savedMode)) {
        console.log(`Carregando modo de transcrição salvo: ${savedMode}`);
        setTranscriptionMode(savedMode);
        previousModeRef.current = savedMode;
      } else {
        // Usar webrtc como padrão se nada estiver salvo
        console.log(`Definindo modo padrão: ${defaultMode}`);
        setTranscriptionMode(defaultMode);
        previousModeRef.current = defaultMode;
        localStorage.setItem('transcription-mode', defaultMode);
      }
      
      // Definir variável global
      window.currentTranscriptionMode = savedMode || defaultMode;
    } catch (e) {
      console.error('Erro ao carregar modo de transcrição:', e);
    }
  }, []);

  // Renderizar os componentes no portal (atualização para incluir opção WebRTC)
  useEffect(() => {
    if (containerRef.current) {
      // Verificar se o modo mudou para evitar re-renderizações desnecessárias
      if (previousModeRef.current !== transcriptionMode) {
        previousModeRef.current = transcriptionMode;
        console.log(`Modo atualizado para: ${transcriptionMode}`);
        
        // Verificar se o serviço WebRTC está disponível quando o modo é webrtc
        if (transcriptionMode === 'webrtc') {
          console.log('Modo WebRTC selecionado, verificando disponibilidade do serviço...');
          if (window.webrtcTranscriptionService) {
            const status = window.webrtcTranscriptionService.getStatus();
            console.log('Status do WebRTC:', status);
            
            if (!status.isInitialized) {
              console.log('Serviço WebRTC não inicializado. Tentando inicializar...');
              // Tentar inicializar o serviço
              const sessionId = window.sessionId || 
                               new URLSearchParams(window.location.search).get('sessionId') || 
                               window.location.pathname.split('/').pop();
              
              if (sessionId) {
                const socket = window.socket || window.constellationSocket;
                if (socket) {
                  console.log(`Inicializando WebRTC para sessão: ${sessionId}`);
                  window.webrtcTranscriptionService.initialize(sessionId, socket, (transcription, options = {}) => {
                    console.log('Transcrição recebida:', transcription);
                    if (options && options.isPartial) {
                      toast.success('Transcrição parcial recebida');
                    } else {
                      toast.success('Transcrição completa recebida');
                    }
                  });
                }
              }
            }
          } else {
            console.warn('Serviço WebRTC não disponível, você deveria ver o botão "Transcrever Agora"');
          }
        }
      }
      
      // Injetamos diretamente os componentes simples e os handlers definidos acima
      ReactDOM.render(
        <>
          <div className="ai-simple-toolbar">
            <button 
              onClick={handleAnalyze}
              className="ai-button analyze-button"
              title="Analisar conversa atual"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z" fill="white"/>
              </svg>
              <span className="button-text">Analisar</span>
            </button>
            
            <button 
              onClick={handleSuggest}
              className="ai-button suggest-button"
              title="Obter sugestões"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20ZM11 16H13V18H11ZM12.61 6.04C10.55 5.79 8.73 7.13 8.27 9.17C8.05 10.3 9.03 10.99 10.1 10.68C10.65 10.5 11.25 10.07 11.36 9.5C11.78 7.83 14.08 8.2 14.08 10.25C14.08 11.28 13.47 11.8 12.69 12.5C11.91 13.2 11 14.09 11 15.25V15.5H13V15.25C13 14.58 13.67 14.11 14.45 13.41C15.23 12.71 16 11.8 16 10.25C16 7.92 14.57 6.29 12.61 6.04Z" fill="white"/>
              </svg>
              <span className="button-text">Sugestões</span>
            </button>
            
            <button 
              onClick={handleReport}
              className="ai-button report-button"
              title="Gerar relatório"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2ZM18 20H6V4H13V9H18V20ZM8 14H16V16H8V14ZM8 18H13V20H8V18ZM8 10H16V12H8V10Z" fill="white"/>
              </svg>
              <span className="button-text">Relatório</span>
            </button>
            
            <div className="mic-controls">
              <button 
                onClick={() => {
                  console.log("Clique no botão de gravação");
                  // Verificar se existe o serviço de WebRTC
                  if (window.webrtcTranscriptionService) {
                    console.log("Usando serviço WebRTC");
                    try {
                      // Verificar se está gravando
                      const status = window.webrtcTranscriptionService.getStatus();
                      console.log("Status do WebRTC:", status);
                      
                      // Verificar se o serviço está inicializado
                      if (!status.isInitialized) {
                        console.log("WebRTC não inicializado, inicializando agora...");
                        
                        // Detectar o sessionId
                        const sessionId = window.sessionId || 
                                         new URLSearchParams(window.location.search).get('sessionId') || 
                                         window.location.pathname.split('/').pop();
                                         
                        if (sessionId) {
                          const socket = window.socket || window.constellationSocket;
                          if (socket) {
                            toast.info("Inicializando serviço de transcrição...");
                            
                            window.webrtcTranscriptionService.initialize(sessionId, socket, (transcription, options = {}) => {
                              console.log('Transcrição recebida:', transcription);
                              if (options && options.isPartial) {
                                toast.success('Transcrição parcial recebida');
                              } else {
                                toast.success('Transcrição completa recebida');
                              }
                            }).then(success => {
                              if (success) {
                                console.log("WebRTC inicializado com sucesso, iniciando gravação...");
                                // Iniciar gravação após inicialização bem-sucedida
                                window.webrtcTranscriptionService.startRecording()
                                  .then((startSuccess) => {
                                    if (startSuccess) {
                                      setIsRecording(true);
                                      toast.success("Gravação iniciada");
                                    } else {
                                      toast.error("Falha ao iniciar gravação");
                                    }
                                  });
                              } else {
                                toast.error("Falha ao inicializar WebRTC");
                              }
                            });
                            return; // Sair da função para evitar o código abaixo
                          } else {
                            toast.error("Socket não disponível");
                          }
                        } else {
                          toast.error("ID de sessão não disponível");
                        }
                      }
                      
                      if (status && status.isRecording) {
                        // Parar gravação
                        console.log("Parando gravação WebRTC");
                        window.webrtcTranscriptionService.stopRecording()
                          .then(() => {
                            setIsRecording(false);
                            toast.info("Gravação parada");
                          });
                      } else {
                        // Iniciar gravação
                        console.log("Iniciando gravação WebRTC");
                        window.webrtcTranscriptionService.startRecording()
                          .then((success) => {
                            if (success) {
                              setIsRecording(true);
                              toast.info("Gravação iniciada");
                            } else {
                              toast.error("Falha ao iniciar gravação");
                            }
                          });
                      }
                    } catch (error) {
                      console.error("Erro ao controlar WebRTC:", error);
                      toast.error("Erro ao controlar gravação");
                    }
                  } else if (window.hybridAIService) {
                    console.log("Usando serviço HybridAI");
                    try {
                      if (window.hybridAIService.isRecording) {
                        window.hybridAIService.stopRecording();
                        setIsRecording(false);
                        toast.info("Gravação parada");
                      } else {
                        window.hybridAIService.startRecording();
                        setIsRecording(true);
                        toast.info("Gravação iniciada");
                      }
                    } catch (error) {
                      console.error("Erro ao controlar HybridAI:", error);
                      toast.error("Erro ao controlar gravação");
                    }
                  } else {
                    console.error("Nenhum serviço de gravação disponível");
                    toast.error("Nenhum serviço de gravação disponível");
                  }
                }}
                className={`mic-button ${isRecording ? 'recording' : ''}`}
                title="Iniciar/Parar gravação"
              >
                <FontAwesomeIcon icon={isRecording ? faMicrophoneSlash : faMicrophone} />
              </button>
              
              <button 
                onClick={async () => {
                  console.log("Clique no botão Transcrever Agora");
                  if (window.webrtcTranscriptionService) {
                    try {
                      toast.info("Solicitando transcrição parcial...");
                      const result = await window.webrtcTranscriptionService.transcribeCurrentAudio();
                      console.log("Resultado da transcrição parcial:", result);
                      if (result && result.transcription) {
                        toast.success("Transcrição parcial recebida!");
                      } else {
                        toast.warning("Nenhuma transcrição parcial disponível");
                      }
                    } catch (error) {
                      toast.error("Erro ao solicitar transcrição parcial");
                      console.error("Erro na transcrição parcial:", error);
                    }
                  } else {
                    toast.error("Serviço WebRTC não disponível");
                  }
                }}
                className="transcribe-now-button"
                title={isRecording ? "Transcrever áudio atual sem parar a gravação" : "Inicie a gravação primeiro para solicitar transcrição parcial"}
                disabled={!isRecording}
              >
                <FontAwesomeIcon icon={faFileAlt} />
                <span className="button-text">Transcrever Agora</span>
              </button>
            </div>
            
            <TranscriptionSelector 
              mode={transcriptionMode} 
              onChange={handleTranscriptionModeChange} 
            />
          </div>
        </>,
        containerRef.current
      );
    }
  }, [transcriptionMode, handleAnalyze, handleSuggest, handleReport, handleTranscriptionModeChange, isRecording]);

  // Este componente não renderiza nada no seu local original
  return null;
};

export default AIToolsContainer; 