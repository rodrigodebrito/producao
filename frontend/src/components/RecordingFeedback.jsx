import React, { useState, useEffect } from 'react';

/**
 * Componente que mostra feedback visual quando a gravação e o microfone estão ativos
 * É exibido apenas quando a classe recording-active está presente no body
 */
const RecordingFeedback = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [message, setMessage] = useState("Gravação em andamento...");
  
  useEffect(() => {
    // Verificar estado inicial
    const recordingActive = document.body.classList.contains('recording-active');
    const micActive = document.body.classList.contains('mic-active');
    setIsVisible(recordingActive);
    setIsMicActive(micActive);
    
    // Atualizar mensagem com base no estado
    updateMessage(recordingActive, micActive);
    
    // Observar mudanças na classe do body
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          const recordingActive = document.body.classList.contains('recording-active');
          const micActive = document.body.classList.contains('mic-active');
          setIsVisible(recordingActive);
          setIsMicActive(micActive);
          updateMessage(recordingActive, micActive);
        }
      });
    });
    
    observer.observe(document.body, { attributes: true });
    
    // Escutar eventos de mudança de estado
    const handleRecordingStarted = () => {
      setIsVisible(true);
      updateMessage(true, isMicActive);
    };
    
    const handleRecordingStopped = () => {
      setIsVisible(false);
    };
    
    const handleAudioActivated = () => {
      setIsMicActive(true);
      updateMessage(isVisible, true);
    };
    
    window.addEventListener('webrtc-recording-started', handleRecordingStarted);
    window.addEventListener('webrtc-recording-stopped', handleRecordingStopped);
    window.addEventListener('webrtc-audio-activated', handleAudioActivated);
    window.addEventListener('webrtc-audio-state-changed', (e) => {
      setIsMicActive(e.detail.enabled);
      updateMessage(isVisible, e.detail.enabled);
    });
    
    return () => {
      observer.disconnect();
      window.removeEventListener('webrtc-recording-started', handleRecordingStarted);
      window.removeEventListener('webrtc-recording-stopped', handleRecordingStopped);
      window.removeEventListener('webrtc-audio-activated', handleAudioActivated);
      window.removeEventListener('webrtc-audio-state-changed', () => {});
    };
  }, [isVisible, isMicActive]);
  
  // Função para atualizar a mensagem com base no estado
  const updateMessage = (recording, mic) => {
    if (recording && mic) {
      setMessage("Gravação em andamento - Microfone ativo");
    } else if (recording) {
      setMessage("Gravação em andamento - Verificando microfone...");
    } else if (mic) {
      setMessage("Microfone ativo");
    } else {
      setMessage("Preparando gravação...");
    }
  };
  
  if (!isVisible) return null;
  
  return (
    <div className="recording-feedback">
      <div className="recording-status">
        {message}
      </div>
      <div className="recording-mic-status">
        {isMicActive ? (
          <span className="mic-status active">Microfone ATIVO</span>
        ) : (
          <span className="mic-status inactive">Aguardando permissão de microfone...</span>
        )}
      </div>
    </div>
  );
};

export default RecordingFeedback; 