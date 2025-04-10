import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faMicrophoneSlash } from '@fortawesome/free-solid-svg-icons';
import './MicButton.css';

/**
 * MicButton component for controlling audio recording
 * @param {Object} props Component props
 * @param {Function} props.onStart Function to call when recording starts
 * @param {Function} props.onStop Function to call when recording stops
 * @param {boolean} props.disabled Whether the button is disabled
 * @param {string} props.mode Recording mode ('daily' or 'local')
 * @param {boolean} props.syncRecording Whether to sync recording state via Socket.IO
 */
const MicButton = ({ onStart, onStop, disabled = false, mode = 'daily', syncRecording = false }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const [remoteTriggered, setRemoteTriggered] = useState(false);

  useEffect(() => {
    // If available, get the participant count from the window object
    const updateParticipantCount = () => {
      if (window.dailyAudioCapture && mode === 'daily') {
        setParticipantCount(window.dailyAudioCapture.getParticipantCount() || 0);
      }
    };

    updateParticipantCount();
    
    // Set up interval to update participant count
    const interval = setInterval(updateParticipantCount, 2000);
    
    return () => {
      clearInterval(interval);
    };
  }, [mode]);

  // Set up socket event listeners for recording synchronization
  useEffect(() => {
    if (!syncRecording || !window.socket) return;
    
    // Listen for recording start event from other participants
    const handleStartRecording = (data) => {
      if (!isRecording && !disabled) {
        console.log('Recebido evento para iniciar gravação remotamente');
        setRemoteTriggered(true);
        setIsRecording(true);
        if (onStart) onStart();
      }
    };
    
    // Listen for recording stop event from other participants
    const handleStopRecording = (data) => {
      if (isRecording) {
        console.log('Recebido evento para parar gravação remotamente');
        setRemoteTriggered(true);
        setIsRecording(false);
        if (onStop) onStop();
      }
    };
    
    window.socket.on('recording-start', handleStartRecording);
    window.socket.on('recording-stop', handleStopRecording);
    
    return () => {
      window.socket.off('recording-start', handleStartRecording);
      window.socket.off('recording-stop', handleStopRecording);
    };
  }, [syncRecording, isRecording, disabled, onStart, onStop]);

  const toggleRecording = useCallback(() => {
    // Prevent double-triggering when handling remote events
    if (remoteTriggered) {
      setRemoteTriggered(false);
      return;
    }

    if (isRecording) {
      setIsRecording(false);
      if (onStop) onStop();
      
      // Emit stop recording event via socket if syncing is enabled
      if (syncRecording && window.socket) {
        const sessionId = window.sessionId || new URLSearchParams(window.location.search).get('sessionId');
        if (sessionId) {
          console.log('Emitindo evento para parar gravação em outros dispositivos');
          window.socket.emit('recording-event', {
            type: 'stop',
            sessionId,
            timestamp: Date.now()
          });
        }
      }
    } else {
      setIsRecording(true);
      if (onStart) onStart();
      
      // Emit start recording event via socket if syncing is enabled
      if (syncRecording && window.socket) {
        const sessionId = window.sessionId || new URLSearchParams(window.location.search).get('sessionId');
        if (sessionId) {
          console.log('Emitindo evento para iniciar gravação em outros dispositivos');
          window.socket.emit('recording-event', {
            type: 'start',
            sessionId,
            timestamp: Date.now()
          });
        }
      }
    }
  }, [isRecording, onStart, onStop, syncRecording, remoteTriggered]);

  const buttonText = isRecording 
    ? `Parar Gravação${mode === 'daily' ? ` (${participantCount} participantes)` : ''}` 
    : 'Iniciar Gravação';

  return (
    <button
      className={`mic-button ${isRecording ? 'recording' : ''}`}
      onClick={toggleRecording}
      disabled={disabled}
      aria-label={isRecording ? 'Parar gravação' : 'Iniciar gravação'}
      title={isRecording ? 'Parar gravação' : 'Iniciar gravação'}
    >
      {isRecording && <div className="recording-indicator" />}
      <span className="mic-icon">
        <FontAwesomeIcon icon={isRecording ? faMicrophoneSlash : faMicrophone} />
      </span>
      {buttonText}
    </button>
  );
};

export default MicButton; 