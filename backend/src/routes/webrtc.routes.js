/**
 * Rotas para o serviço WebRTC
 * Gerencia os endpoints relacionados à captura de áudio e transcrição
 */

const express = require('express');
const router = express.Router();
const cors = require('cors');
const webRTCController = require('../controllers/webrtc.controller');
const { authMiddleware } = require('../middleware/auth.middleware');
const flexAuthMiddleware = require('../middleware/flex-auth.middleware');

// Configuração específica de CORS para as rotas WebRTC
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://terapiaconect.com', 'https://www.terapiaconect.com', 'https://terapia-conect-frontend.vercel.app', 'https://terapia-conect-frontend-git-main-rodrigodebrito.vercel.app'] 
    : ['http://localhost:3001', 'http://localhost:5173', '*'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'x-requested-with', 'X-Test-Auth']
};

// API pública para WebRTC

/**
 * @route POST /api/webrtc/session/:sessionId
 * @desc Inicializa uma sessão WebRTC
 * @access Autenticado
 */
router.post(
  '/session/:sessionId',
  cors(corsOptions),
  authMiddleware,
  flexAuthMiddleware,
  webRTCController.initSession
);

/**
 * @route POST /api/webrtc/record/start/:sessionId
 * @desc Inicia a gravação do áudio para uma sessão
 * @access Autenticado
 */
router.post(
  '/record/start/:sessionId',
  cors(corsOptions),
  authMiddleware,
  flexAuthMiddleware,
  webRTCController.startRecording
);

/**
 * @route POST /api/webrtc/record/stop/:sessionId
 * @desc Para a gravação do áudio e retorna a transcrição
 * @access Autenticado
 */
router.post(
  '/record/stop/:sessionId',
  cors(corsOptions),
  authMiddleware,
  flexAuthMiddleware,
  webRTCController.stopRecording
);

/**
 * @route POST /api/webrtc/record/transcribe/:sessionId
 * @desc Transcreve o áudio atual sem parar a gravação
 * @access Autenticado
 */
router.post(
  '/record/transcribe/:sessionId',
  cors(corsOptions),
  authMiddleware,
  flexAuthMiddleware,
  webRTCController.transcribeCurrentAudio
);

/**
 * @route GET /api/webrtc/sessions
 * @desc Lista todas as sessões WebRTC ativas
 * @access Autenticado
 */
router.get(
  '/sessions',
  cors(corsOptions),
  authMiddleware,
  flexAuthMiddleware,
  webRTCController.getActiveSessions
);

/**
 * @route DELETE /api/webrtc/session/:sessionId
 * @desc Encerra uma sessão WebRTC
 * @access Autenticado
 */
router.delete(
  '/session/:sessionId',
  cors(corsOptions),
  authMiddleware,
  flexAuthMiddleware,
  webRTCController.closeSession
);

/**
 * @route POST /api/webrtc/register-participant/:sessionId/:participantId
 * @desc Registra explicitamente um participante na sessão WebRTC
 * @access Autenticado
 */
router.post(
  '/register-participant/:sessionId/:participantId',
  cors(corsOptions),
  authMiddleware,
  flexAuthMiddleware,
  webRTCController.registerParticipant
);

// Middleware OPTIONS para preflight em todas as rotas
router.options('*', cors(corsOptions));

module.exports = router; 