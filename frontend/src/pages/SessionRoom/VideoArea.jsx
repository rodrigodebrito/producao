import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useSession } from '../../contexts/SessionContext';
import DailyVideo from '../../components/DailyVideo';

const VideoArea = ({ isFloating }) => {
  const { session } = useSession();
  const videoAreaRef = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Funções para arrastar o vídeo quando em modo flutuante
  const handleMouseDown = (e) => {
    if (!isFloating) return;
    
    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    
    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;
    
    setPosition({ x: newX, y: newY });
    
    if (videoAreaRef.current) {
      videoAreaRef.current.style.transform = `translate(${newX}px, ${newY}px)`;
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Aplicar eventos de mouse quando em modo flutuante
  useEffect(() => {
    if (isFloating) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isFloating, isDragging, dragStart]);

  return (
    <div 
      ref={videoAreaRef}
      className={`video-area ${isFloating ? 'video-floating' : ''}`}
      onMouseDown={handleMouseDown}
      style={{
        width: '100%',
        height: '100%',
        minHeight: '400px'
      }}
    >
      {isFloating && (
        <div className="restore-video">
          <span role="img" aria-label="Mover">↔️</span>
        </div>
      )}
      <div className="video-container" style={{ width: '100%', height: '100%' }}>
        {session?.dyteRoomName ? (
          <DailyVideo 
            url={session.dyteRoomName} 
            token={session.authToken}
          />
        ) : (
          <div className="video-placeholder">
            <p>Carregando sala de videoconferência...</p>
          </div>
        )}
      </div>
    </div>
  );
};

VideoArea.propTypes = {
  isFloating: PropTypes.bool
};

VideoArea.defaultProps = {
  isFloating: false
};

export default VideoArea; 