import React, { useState, useEffect } from 'react';
import './AIComponents.css';

// Mic icons for different states
const MicIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
  </svg>
);

const StopIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
  </svg>
);

const SystemAudioIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
  </svg>
);

const MicrophoneIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
  </svg>
);

const MicButton = ({ onRecordingStart, onRecordingStop, disabled }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const [recordingTime, setRecordingTime] = useState(0);
  const [timerId, setTimerId] = useState(null);
  const [captureMode, setCaptureMode] = useState('mic'); // 'mic' ou 'system'

  // Clean up media recorder and timer on component unmount
  useEffect(() => {
    return () => {
      if (mediaRecorder) {
        try {
          mediaRecorder.stop();
        } catch (error) {
          console.error('Error stopping media recorder:', error);
        }
      }
      
      if (timerId) {
        clearInterval(timerId);
      }
    };
  }, [mediaRecorder, timerId]);

  // Toggle between mic and system audio
  const toggleCaptureMode = () => {
    if (isRecording) return; // Não permitir alteração durante gravação
    
    const newMode = captureMode === 'mic' ? 'system' : 'mic';
    setCaptureMode(newMode);
    console.log(`Modo de captura alterado para: ${newMode}`);
  };

  const startRecording = async () => {
    try {
      if (captureMode === 'mic') {
        // Gravação normal apenas do microfone
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Create new media recorder
        const recorder = new MediaRecorder(stream);
        setMediaRecorder(recorder);
        
        // Reset audio chunks
        setAudioChunks([]);
        
        // Start recording timer
        const timer = setInterval(() => {
          setRecordingTime(prev => prev + 1);
        }, 1000);
        setTimerId(timer);
        
        // Handle data available event
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            setAudioChunks(prev => [...prev, event.data]);
          }
        };
        
        // Handle recording stop event
        recorder.onstop = () => {
          // Clear timer
          clearInterval(timer);
          setTimerId(null);
          
          // Process audio data
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          if (onRecordingStop) {
            onRecordingStop(audioBlob);
          }
          
          // Reset state
          setIsRecording(false);
          setRecordingTime(0);
          
          // Stop all tracks in the stream
          stream.getTracks().forEach(track => track.stop());
        };
        
        // Start recording
        recorder.start();
        setIsRecording(true);
      } else {
        // Modo de captura do sistema - mais complexo
        try {
          alert("Você será solicitado a compartilhar sua tela. Por favor, selecione 'Compartilhar áudio' na janela de compartilhamento.");
          
          // Solicitamos permissão para gravação do sistema e do microfone
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: false,
            audio: true
          });
          
          // Verificar se temos faixas de áudio
          if (displayStream.getAudioTracks().length === 0) {
            alert("Você precisa selecionar 'Compartilhar áudio' para capturar o som da chamada.");
            micStream.getTracks().forEach(track => track.stop());
            displayStream.getTracks().forEach(track => track.stop());
            return;
          }
          
          // Combinar os dois streams usando AudioContext
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();
          const destination = audioContext.createMediaStreamDestination();
          
          // Conectar microfone
          const micSource = audioContext.createMediaStreamSource(micStream);
          micSource.connect(destination);
          
          // Conectar áudio do sistema
          const systemSource = audioContext.createMediaStreamSource(displayStream);
          systemSource.connect(destination);
          
          const combinedStream = destination.stream;
          
          // Criar recorder para o stream combinado
          const options = {};
          if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            options.mimeType = 'audio/webm;codecs=opus';
          }
          
          const recorder = new MediaRecorder(combinedStream, options);
          setMediaRecorder(recorder);
          setAudioChunks([]);
          
          // Configurar timer
          const timer = setInterval(() => {
            setRecordingTime(prev => prev + 1);
          }, 1000);
          setTimerId(timer);
          
          // Configurar eventos
          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              setAudioChunks(prev => [...prev, event.data]);
            }
          };
          
          recorder.onstop = () => {
            clearInterval(timer);
            setTimerId(null);
            
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            if (onRecordingStop) {
              onRecordingStop(audioBlob);
            }
            
            // Reset state
            setIsRecording(false);
            setRecordingTime(0);
            
            // Parar todas as tracks
            micStream.getTracks().forEach(track => track.stop());
            displayStream.getTracks().forEach(track => track.stop());
            
            // Fechar o audio context
            audioContext.close();
          };
          
          // Iniciar gravação
          recorder.start();
          setIsRecording(true);
        } catch (error) {
          console.error('Erro ao iniciar captura de áudio do sistema:', error);
          alert('Erro ao acessar áudio do sistema. Verifique se você permitiu o compartilhamento de áudio.');
          return;
        }
      }
      
      if (onRecordingStart) {
        onRecordingStart();
      }
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Error accessing microphone. Please ensure you have granted permission to use the microphone.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  };

  const toggleRecording = () => {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  };

  // Format recording time as MM:SS
  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="mic-button-container">
      <div className="capture-mode-selector">
        <button 
          onClick={toggleCaptureMode}
          className={`mode-selector-button ${captureMode === 'system' ? 'system-mode' : 'mic-mode'} ${isRecording ? 'disabled' : ''}`}
          disabled={isRecording}
          title={captureMode === 'mic' ? 'Mudar para captura de áudio da chamada + microfone' : 'Mudar para captura apenas do microfone'}
        >
          {captureMode === 'mic' ? (
            <>
              <MicrophoneIcon />
              <span>Apenas Microfone</span>
            </>
          ) : (
            <>
              <SystemAudioIcon />
              <span>Microfone + Chamada</span>
            </>
          )}
        </button>
      </div>
      <button
        className={`mic-button ${isRecording ? 'recording' : 'not-recording'}`}
        onClick={toggleRecording}
        disabled={disabled}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        title={isRecording ? 'Stop recording' : 'Start recording'}
      >
        {isRecording ? <StopIcon /> : <MicIcon />}
      </button>
      {isRecording && (
        <div className="recording-info">
          <div className="recording-time">{formatTime(recordingTime)}</div>
          <div className="recording-mode">
            {captureMode === 'mic' ? 'Gravando microfone' : 'Gravando microfone + chamada'}
          </div>
        </div>
      )}
    </div>
  );
};

export default MicButton; 