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
 */
const MicButton = ({ onStart, onStop, disabled = false, mode = 'daily' }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);

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

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      setIsRecording(false);
      if (onStop) onStop();
    } else {
      setIsRecording(true);
      if (onStart) onStart();
    }
  }, [isRecording, onStart, onStop]);

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