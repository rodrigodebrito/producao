import React, { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'react-toastify';
import { useAI } from '../contexts/AIContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faMicrophoneSlash } from '@fortawesome/free-solid-svg-icons';
import hybridAIService from '../services/hybridAI.service';
import WhisperTranscriptionService from '../services/whisperTranscriptionService';
import AIResultsPanel from './AIResultsPanel';
import './AITools.css';
import ReactDOM from 'react-dom';

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
          {mode === 'auto' ? 'Auto' : 
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
  const recordingTimerRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  
  // Atualizar o modo quando a prop mudar
  useEffect(() => {
    if (currentMode !== transcriptionMode) {
      console.log(`MicButton: Modo de transcrição alterado de ${currentMode} para ${transcriptionMode}`);
      setCurrentMode(transcriptionMode);
      
      // Se estiver gravando, reiniciar para aplicar o novo modo
      if (isRecording) {
        console.log('Reiniciando gravação para aplicar novo modo de transcrição');
        // Parar brevemente e reiniciar
        if (window.hybridAIService) {
          window.hybridAIService.stopRecording();
        }
        
        if (window.whisperService) {
          window.whisperService.stopRecording();
        }
        
        // Pequeno delay e reinicia com o novo modo
        setTimeout(() => restartRecording(), 500);
      }
    }
  }, [transcriptionMode, currentMode, isRecording]);
  
  // Definir a função restartRecording
  const restartRecording = useCallback(() => {
    try {
      console.log('Reiniciando gravação de voz...');
      console.log(`Modo de transcrição selecionado: ${currentMode}`);
      
      // Parar qualquer instância ativa
      if (window.hybridAIService) {
        window.hybridAIService.stopRecording();
      }
      
      if (window.whisperService) {
        window.whisperService.stopRecording();
      }
      
      // Pequeno delay para garantir que tudo foi limpo
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        // Decidir qual serviço usar baseado no modo selecionado
        if (currentMode === 'whisper') {
          if (window.whisperService) {
            console.log('Iniciando APENAS o serviço Whisper');
            window.whisperService.startRecording();
            setIsRecording(true);
            setIsPaused(false);
            toast.info('Reconhecimento Whisper iniciado');
          }
        } else if (currentMode === 'webspeech') {
          if (window.hybridAIService) {
            console.log('Iniciando APENAS o serviço Web Speech API');
            window.hybridAIService.startRecording();
            setIsRecording(true);
            setIsPaused(false);
            toast.info('Reconhecimento Web Speech iniciado');
          }
        } else if (currentMode === 'auto') {
          // No modo auto, inicia ambos
          console.log('Modo AUTO: Iniciando ambos os serviços de transcrição');
          let started = false;
          
          if (window.whisperService) {
            window.whisperService.startRecording();
            started = true;
          }
          
          if (window.hybridAIService) {
            window.hybridAIService.startRecording();
            started = true;
          }
          
          if (started) {
            setIsRecording(true);
            setIsPaused(false);
            toast.info('Reconhecimento híbrido iniciado');
          } else {
            toast.error('Nenhum serviço de reconhecimento disponível');
            setIsRecording(false);
          }
        }
      }, 1000);
    } catch (e) {
      console.error('Erro ao reiniciar gravação:', e);
      setIsRecording(false);
      setIsPaused(false);
    }
  }, [currentMode]);
  
  // Inicializar os serviços de transcrição
  useEffect(() => {
    // Verificar se os serviços já foram inicializados globalmente
    if (!window.hybridAIService) {
      console.log('Inicializando serviço Web Speech API');
      window.hybridAIService = hybridAIService;
    }
    
    if (!window.whisperService) {
      console.log('Inicializando serviço Whisper');
      window.whisperService = WhisperTranscriptionService;
    }
    
    // Limpar ao desmontar
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
      }
    };
  }, []);
  
  // Alternar entre gravar e parar
  const toggleMicrophone = useCallback(() => {
    try {
      if (isRecording) {
        // Parar gravação
        console.log('Parando gravação de voz');
        
        if (window.hybridAIService) {
          window.hybridAIService.stopRecording();
        }
        
        if (window.whisperService) {
          window.whisperService.stopRecording();
        }
        
        setIsRecording(false);
        toast.info('Reconhecimento de voz parado');
      } else {
        // Iniciar gravação
        console.log('Iniciando gravação de voz');
        restartRecording();
      }
    } catch (error) {
      console.error('Erro ao alternar microfone:', error);
      toast.error('Erro ao controlar reconhecimento de voz');
    }
  }, [isRecording, restartRecording]);
  
  // Renderização do ícone do microfone
  const renderIcon = () => {
    return <FontAwesomeIcon 
      icon={isRecording ? faMicrophoneSlash : faMicrophone} 
      className="mic-icon" 
    />;
  };
  
  return (
    <button 
      onClick={toggleMicrophone}
      className={`mic-button ${isRecording ? 'recording' : ''}`}
      title={isRecording ? `Parar gravação (${currentMode})` : `Iniciar gravação (${currentMode})`}
    >
      {renderIcon()}
    </button>
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
  const [transcriptionMode, setTranscriptionMode] = useState('auto');
  const containerRef = useRef(null);
  const previousModeRef = useRef('auto');
  
  // Obter funções de IA do contexto para que possam ser passadas aos botões
  const { analyze, suggest, report } = useAI();

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

  // Função específica para mudar o modo de transcrição
  const handleTranscriptionModeChange = useCallback((newMode) => {
    console.log(`Alterando modo de transcrição de ${transcriptionMode} para ${newMode}`);
    setTranscriptionMode(newMode);
    previousModeRef.current = newMode;
    
    // Salvar na localStorage para manter a configuração entre sessões
    try {
      localStorage.setItem('transcription-mode', newMode);
      console.log(`Modo de transcrição '${newMode}' salvo na localStorage`);
    } catch (e) {
      console.error('Erro ao salvar modo de transcrição:', e);
    }
    
    toast.info(`Modo de transcrição alterado para: ${newMode === 'auto' ? 'Auto' : 
                newMode === 'whisper' ? 'Whisper (Alta precisão)' : 
                'Browser (Tempo real)'}`);
  }, [transcriptionMode]);

  // Carregar configuração salva na inicialização
  useEffect(() => {
    try {
      const savedMode = localStorage.getItem('transcription-mode');
      if (savedMode && ['auto', 'whisper', 'webspeech'].includes(savedMode)) {
        console.log(`Carregando modo de transcrição salvo: ${savedMode}`);
        setTranscriptionMode(savedMode);
        previousModeRef.current = savedMode;
      }
    } catch (e) {
      console.error('Erro ao carregar modo de transcrição:', e);
    }
  }, []);

  // Renderizar os componentes no portal
  useEffect(() => {
    if (containerRef.current) {
      // Verificar se o modo mudou para evitar re-renderizações desnecessárias
      if (previousModeRef.current !== transcriptionMode) {
        previousModeRef.current = transcriptionMode;
        console.log(`Modo atualizado para: ${transcriptionMode}`);
      }
      
      // Injetamos diretamente os componentes simples e os handlers definidos acima
      ReactDOM.render(
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
          
          <MicButton transcriptionMode={transcriptionMode} />
          
          <TranscriptionSelector 
            mode={transcriptionMode} 
            onChange={handleTranscriptionModeChange} 
          />
        </div>,
        containerRef.current
      );
    }
  }, [transcriptionMode, handleAnalyze, handleSuggest, handleReport, handleTranscriptionModeChange]);

  // Este componente não renderiza nada no seu local original
  return null;
};

export default AIToolsContainer; 