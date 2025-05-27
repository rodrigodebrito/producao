import React, { useEffect, useRef } from 'react';
import DailyIframe from '@daily-co/daily-js';

const DailyVideo = ({ url, token }) => {
  const videoRef = useRef(null);
  const callFrameRef = useRef(null);

  useEffect(() => {
    if (!url) return;

    const initDaily = async () => {
      try {
        console.log('Iniciando Daily.co com URL:', url);
        
        if (callFrameRef.current) {
          callFrameRef.current.destroy();
        }

        const dailyConfig = {
          url: url,
          token: token,
          showLeaveButton: true,
          iframeStyle: {
            width: '100%',
            height: '100%',
            border: '0',
            borderRadius: '8px'
          }
        };

        callFrameRef.current = DailyIframe.createFrame(
          videoRef.current,
          dailyConfig
        );

        await callFrameRef.current.join();
        console.log('Daily.co conectado com sucesso');
      } catch (error) {
        console.error('Erro ao inicializar Daily.co:', error);
      }
    };

    initDaily();

    return () => {
      if (callFrameRef.current) {
        callFrameRef.current.destroy();
      }
    };
  }, [url, token]);

  return (
    <div 
      ref={videoRef} 
      style={{ 
        width: '100%', 
        height: '100%',
        minHeight: '400px',
        backgroundColor: '#1a1a1a',
        borderRadius: '8px'
      }}
    />
  );
};

export default DailyVideo; 