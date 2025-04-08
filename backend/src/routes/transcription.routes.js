const express = require('express');
const router = express.Router();
const transcriptionController = require('../controllers/transcription.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('../middleware/auth.middleware');

// Middleware de autenticação flexível para desenvolvimento
const flexAuthMiddleware = (req, res, next) => {
  // Em ambiente de desenvolvimento, permitir acesso mesmo sem token
  if (process.env.NODE_ENV === 'development' && !req.user) {
    req.user = { id: 1, role: 'ADMIN' }; // Usuário padrão para desenvolvimento
  }
  next();
};

// Configurar o multer para upload de arquivos de áudio/vídeo
const uploadDir = path.join(__dirname, '../../uploads/media');

// DESABILITADO: Criação de diretório (apenas para o deploy)
// if (!fs.existsSync(uploadDir)) {
//   fs.mkdirSync(uploadDir, { recursive: true });
// }
console.log('Diretório de upload:', uploadDir, '(criação desabilitada)');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/media');
    
    // DESABILITADO: Criação de diretório (apenas para o deploy)
    // if (!fs.existsSync(dir)) {
    //   fs.mkdirSync(dir, { recursive: true });
    // }
    console.log('Diretório de destino:', dir, '(criação desabilitada)');
    
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Usar timestamp para evitar nomes duplicados
    const timestamp = Date.now();
    const originalName = file.originalname;
    const extension = path.extname(originalName);
    const filename = `${timestamp}-${path.basename(originalName, extension)}${extension}`;
    cb(null, filename);
  }
});

// Filtrar os tipos de arquivo permitidos
const fileFilter = (req, file, cb) => {
  // Aceitar apenas arquivos de áudio e vídeo
  if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error('Formato de arquivo não suportado. Envie apenas arquivos de áudio ou vídeo.'), false);
  }
};

// Configurar o upload com limites
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});

// Rota para iniciar uma transcrição (rota raiz)
router.post(
  '/', 
  authMiddleware, 
  flexAuthMiddleware,
  upload.single('media'), 
  transcriptionController.transcribeMedia
);

// Rota adicional para iniciar uma transcrição (compatibilidade com frontend)
router.post(
  '/transcribe', 
  authMiddleware, 
  flexAuthMiddleware,
  upload.single('media'), 
  transcriptionController.transcribeMedia
);

// Rota para verificar o status de uma transcrição
router.get(
  '/:id/status',
  authMiddleware,
  flexAuthMiddleware,
  transcriptionController.getTranscriptionStatus
);

// Rota adicional para verificar o status (compatibilidade com frontend)
router.get(
  '/status/:id',
  authMiddleware,
  flexAuthMiddleware,
  transcriptionController.getTranscriptionStatus
);

// Rota para obter o resultado de uma transcrição
router.get(
  '/:id',
  authMiddleware,
  flexAuthMiddleware,
  transcriptionController.getTranscription
);

// Rota para cancelar uma transcrição em andamento
router.delete(
  '/:id',
  authMiddleware,
  flexAuthMiddleware,
  transcriptionController.cancelTranscription
);

module.exports = router; 