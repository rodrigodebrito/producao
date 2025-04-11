import React, { useState, useEffect } from 'react';
import MicButton from './MicButton';
import RecordingModeSelector from './RecordingModeSelector';
import './TranscriptionControls.css';
import aiService from '../services/aiService';

/**
 * Componente para controle de transcrição de áudio
 * 
 * @param {Object} props
 * @param {Function} props.onTranscriptionComplete - Callback quando a transcrição estiver completa
 * @param {string} props.sessionId - ID da sessão atual
 * @param {boolean} props.syncRecording - Se deve sincronizar a gravação entre dispositivos
 * @param {Object} props.socket - Socket.IO para comunicação
 */
const TranscriptionControls = ({ 
  onTranscriptionComplete, 
  sessionId, 
  syncRecording = false,
  socket 
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [recordingMode, setRecordingMode] = useState('webspeech'); // webspeech, webrtc, daily
  const [dailyStatus, setDailyStatus] = useState({ connected: false });
  const [showRecordingModeSelector, setShowRecordingModeSelector] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [syncBetweenDevices, setSyncBetweenDevices] = useState(syncRecording);

  useEffect(() => {
    // Verificar status do Daily se disponível
    if (window.dailyAudioCapture && typeof window.dailyAudioCapture.isConnected === 'function') {
      setDailyStatus({
        connected: window.dailyAudioCapture.isConnected()
      });
    }
  }, []);

  const handleRecordingStart = () => {
    console.log(`TranscriptionControls: Iniciando gravação no modo: ${recordingMode}`);
    setError(null);
    setIsRecording(true);
  };

  const handleRecordingStop = async (audioBlob) => {
    console.log(`TranscriptionControls: Gravação finalizada (modo: ${recordingMode})`);
    
    // Se o modo for WebRTC, o próprio serviço já processa a transcrição
    // e o áudio pode ser null, porque o MicButton recebe a transcrição diretamente
    if (recordingMode === 'webrtc') {
      console.log('TranscriptionControls: Modo WebRTC, transcrição gerenciada pelo serviço WebRTC');
      
      // Se audioBlob for string, é a transcrição já processada
      if (typeof audioBlob === 'string') {
        console.log('TranscriptionControls: Transcrição recebida via WebRTC');
        if (onTranscriptionComplete) {
          onTranscriptionComplete(audioBlob, { isComplete: true });
        }
        return;
      }
    }
    
    // Para os outros modos, processa o audioBlob normalmente
    try {
      if (!audioBlob) {
        console.error('TranscriptionControls: Erro: audioBlob é undefined ou null');
        setError('Erro ao processar áudio: Nenhum áudio foi capturado');
        return;
      }
      
      setIsProcessing(true);
      
      // Create a FormData object to send the audio file
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('sessionId', sessionId);
      
      console.log(`TranscriptionControls: Enviando áudio para transcrição (sessão: ${sessionId})`);
      
      // Send the audio to the server for transcription
      const response = await aiService.transcribeAudio(formData);
      
      if (response && response.transcript) {
        console.log('TranscriptionControls: Transcrição recebida com sucesso');
        // Call the callback with the transcription result
        if (onTranscriptionComplete) {
          onTranscriptionComplete(response.transcript, { isComplete: true });
        }
      } else {
        throw new Error('No transcript received from the server');
      }
    } catch (error) {
      console.error('TranscriptionControls: Erro ao processar áudio:', error);
      setError(`Erro ao processar áudio: ${error.message}`);
    } finally {
      setIsProcessing(false);
      setIsRecording(false);
    }
  };
  
  const handlePartialTranscription = (transcription, options = {}) => {
    console.log(`TranscriptionControls: Transcrição parcial recebida (tempo: ${options.timestamp || 'desconhecido'})`);
    
    if (!transcription) {
      console.error('TranscriptionControls: Erro: transcrição parcial é undefined ou null');
      setError('Erro ao processar transcrição parcial: Nenhum texto foi recebido');
      return;
    }
    
    // Chamar o callback com a transcrição parcial
    if (onTranscriptionComplete) {
      onTranscriptionComplete(transcription, { 
        isPartial: true, 
        timestamp: options.timestamp,
        duration: options.duration 
      });
    }
  };

  return (
    <div className="transcription-controls">
      <div className="transcription-controls-options">
        {showRecordingModeSelector && (
          <RecordingModeSelector 
            selectedMode={recordingMode} 
            onModeChange={setRecordingMode} 
            disabled={isRecording || isProcessing} 
          />
        )}
        
        <MicButton 
          onStart={handleRecordingStart} 
          onStop={handleRecordingStop}
          onPartialTranscription={handlePartialTranscription}
          disabled={isProcessing || (recordingMode === 'daily' && !dailyStatus.connected)} 
          mode={recordingMode}
          syncRecording={syncBetweenDevices}
          sessionId={sessionId}
          socket={socket}
        />
      </div>
      
      {isProcessing && 
        <div className="processing-indicator">
          <div className="spinner"></div>
          <span>Processando transcrição...</span>
        </div>
      }
      
      {error && <div className="error-message">{error}</div>}
    </div>
  );
};

export default TranscriptionControls; 