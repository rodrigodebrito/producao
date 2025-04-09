const express = require('express');
const { body } = require('express-validator');
const aiController = require('../controllers/ai.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const openaiService = require('../services/ai/openai.service');

// Importar o middleware de upload de áudio
const audioUpload = require('../utils/audioUpload');

// Criação automática do diretório de upload
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  console.log(`Criando diretório de uploads: ${uploadDir}`);
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configuração para arquivos em disco
const diskStorage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const memoryUpload = multer({ 
  storage: diskStorage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Configuração para armazenamento de áudio em disco
const audioStorage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'audio-' + uniqueSuffix + ext);
  }
});

const audioUploadConfig = multer({ 
  storage: audioStorage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: function (req, file, cb) {
    // Verificar tipo de arquivo
    const allowedMimeTypes = [
      'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 
      'audio/ogg', 'audio/flac', 'audio/x-m4a', 'video/mp4',
      'video/mpeg', 'video/webm'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      console.warn(`Arquivo rejeitado: ${file.originalname}, tipo: ${file.mimetype}`);
      cb(new Error(`Tipo de arquivo não suportado: ${file.mimetype}. Use mp3, wav, webm, ogg, flac, mp4, etc.`));
    }
  }
});

// Configuração para armazenar áudio em memória (para Whisper)
const memoryStorage = multer.memoryStorage();

// Configuração para upload de áudio específica para Whisper
const whisperUploadConfig = multer({ 
  storage: memoryStorage, // Usar armazenamento em memória
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: function (req, file, cb) {
    // Verificar tipo de arquivo
    const allowedMimeTypes = [
      'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 
      'audio/ogg', 'audio/flac', 'audio/x-m4a', 'video/mp4',
      'video/mpeg', 'video/webm'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      console.warn(`Arquivo rejeitado para Whisper: ${file.originalname}, tipo: ${file.mimetype}`);
      cb(new Error(`Tipo de arquivo não suportado: ${file.mimetype}. Use mp3, wav, webm, ogg, flac, mp4, etc.`));
    }
  }
});

const router = express.Router();

// Rotas públicas (sem autenticação)

// Rota de teste simples
router.get('/test', async (req, res) => {
    try {
        console.log('AI Routes: Testando OpenAI Service com uma chamada simples');
        const response = await openaiService.analyzeText("Olá, isso é um teste de integração.");
        console.log('AI Routes: OpenAI Service respondeu com sucesso');
        res.json({ analysis: response });
    } catch (error) {
        console.error('Erro no teste:', error);
        res.status(500).json({
            message: 'Erro no teste de integração',
            details: error.message
        });
    }
});

// Verificar configuração da API OpenAI
router.get('/openai-check', async (req, res) => {
    try {
        // Verificar se a chave API está configurada
        const apiKey = process.env.OPENAI_API_KEY;
        const hasApiKey = !!apiKey;
        const validFormat = hasApiKey && apiKey.startsWith('sk-') && apiKey.length > 20;
        
        return res.json({
            configured: hasApiKey,
            validFormat: validFormat,
            apiDisabled: false,
            message: hasApiKey 
                ? (validFormat ? 'API OpenAI configurada corretamente' : 'Formato da chave API parece inválido') 
                : 'Chave API não configurada'
        });
    } catch (error) {
        console.error('Erro ao verificar API OpenAI:', error);
        res.status(500).json({
            configured: false,
            error: error.message
        });
    }
});

// Testar conexão com API OpenAI (se o método existir no controlador)
if (typeof aiController.checkOpenAI === 'function') {
    router.get('/openai-public-test', aiController.checkOpenAI);
}

// Middleware de autenticação para todas as rotas abaixo
router.use(authenticate);

// Adicionar transcrição
router.post(
  '/transcriptions',
  [
    body('sessionId').isString().notEmpty(),
    body('speaker').isString().notEmpty(),
    body('content').isString().notEmpty(),
    body('timestamp').isISO8601().optional()
  ],
  aiController.addTranscription
);

// Obter transcrições de uma sessão
router.get('/transcriptions/session/:sessionId', aiController.getSessionTranscripts);

// Rotas para serviços de IA (autenticadas)
// Verificar se as funções existem no controlador antes de criar as rotas
if (typeof aiController.saveTranscript === 'function') {
    router.post('/transcript', aiController.saveTranscript);
}

// Nova rota para salvar insights de emoções como AIInsight
router.post('/insights', async (req, res) => {
  try {
    const { sessionId, type, content, keywords } = req.body;
    const userId = req.user?.id;
    
    if (!sessionId || !type || !content) {
      return res.status(400).json({ message: 'sessionId, type e content são obrigatórios' });
    }
    
    // Verificar se a sessão existe e se o usuário tem acesso
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { therapist: true, client: true }
    });
    
    if (!session) {
      return res.status(404).json({ message: 'Sessão não encontrada' });
    }
    
    // Verificar permissão
    const isTherapist = session.therapist?.userId === userId;
    const isClient = session.client?.userId === userId;
    
    if (!isTherapist && !isClient) {
      return res.status(403).json({ message: 'Acesso não autorizado a esta sessão' });
    }
    
    // Criar o insight
    const insight = await prisma.aIInsight.create({
      data: {
        sessionId,
        type,
        content,
        keywords
      }
    });
    
    res.status(201).json({
      message: 'Insight criado com sucesso',
      data: insight
    });
  } catch (error) {
    console.error('Erro ao salvar insight:', error);
    res.status(500).json({ message: 'Erro ao processar solicitação', error: error.message });
  }
});

router.post('/analyze', aiController.analyzeSession);

if (typeof aiController.analyzeText === 'function') {
    router.post('/analyze-text', aiController.analyzeText);
}

router.post('/suggest', aiController.generateSuggestions);
router.post('/report', aiController.generateReport);

// Versões alternativas com parâmetros na URL
router.post('/analyze/:sessionId', aiController.analyzeSession);
router.post('/suggest/:sessionId', aiController.generateSuggestions);
router.post('/report/:sessionId', aiController.generateReport);

// Teste autenticado da API OpenAI (se o método existir no controlador)
if (typeof aiController.checkOpenAI === 'function') {
    router.get('/openai-test', aiController.checkOpenAI);
}

/**
 * @route POST /ai/analyze-session
 * @desc Analisar uma sessão terapêutica
 * @access Privado
 */
router.post('/analyze-session', authenticate, async (req, res) => {
  try {
    const { sessionId, useAdvancedAnalysis } = req.body;
    // CORREÇÃO: Aceitar tanto 'transcript' quanto 'content'
    const transcript = req.body.transcript || req.body.content || '';
    
    // Log para debug
    console.log(`AI Routes: Analisando sessão ${sessionId}, tamanho do texto: ${transcript.length} caracteres`);
    
    // Validar dados obrigatórios
    if (!sessionId && !transcript) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'sessionId ou transcript/content são obrigatórios' 
      });
    }
    
    console.log(`Analisando sessão ${sessionId}`);
    
    // Importar o serviço OpenAI
    const openaiService = require('../services/ai/openai.service');
    
    // Se transcript não foi fornecido, buscar do banco de dados
    let finalTranscript = transcript;
    if (!finalTranscript && sessionId) {
      const transcriptions = await prisma.transcription.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' }
      });
      
      if (transcriptions.length > 0) {
        finalTranscript = transcriptions.map(t => t.content).join('\n\n');
      }
    }
    
    // Se não houver transcrição, retornar erro
    if (!finalTranscript) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Não há transcrição disponível para análise' 
      });
    }
    
    // Analisar a transcrição
    const analysis = await openaiService.analyzeText(finalTranscript);
    
    return res.json({ 
      status: 'success', 
      message: 'Análise realizada com sucesso',
      type: 'analysis',
      analysis
    });
  } catch (error) {
    console.error('Erro ao analisar sessão:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: 'Erro ao analisar sessão',
      error: error.message
    });
  }
});

/**
 * @route POST /ai/suggest
 * @desc Gerar sugestões para terapeuta baseado na transcrição
 * @access Privado
 */
router.post('/suggest', authenticate, async (req, res) => {
  try {
    const { sessionId } = req.body;
    // CORREÇÃO: Aceitar tanto 'transcript' quanto 'content'
    const transcript = req.body.transcript || req.body.content || '';
    
    // Log para debug
    console.log(`AI Routes: Gerando sugestões para sessão ${sessionId}, tamanho do texto: ${transcript.length} caracteres`);
    
    // Validar dados obrigatórios
    if (!sessionId && !transcript) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'sessionId ou transcript/content são obrigatórios' 
      });
    }
    
    console.log(`Gerando sugestões para sessão ${sessionId}`);
    
    // Importar o serviço OpenAI
    const openaiService = require('../services/ai/openai.service');
    
    // Se transcript não foi fornecido, buscar do banco de dados
    let finalTranscript = transcript;
    if (!finalTranscript && sessionId) {
      const transcriptions = await prisma.transcription.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' }
      });
      
      if (transcriptions.length > 0) {
        finalTranscript = transcriptions.map(t => t.content).join('\n\n');
      }
    }
    
    // Se não houver transcrição, retornar erro
    if (!finalTranscript) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Não há transcrição disponível para sugestões' 
      });
    }
    
    // Gerar sugestões
    const suggestions = await openaiService.generateSuggestions(finalTranscript);
    
    return res.json({ 
      status: 'success', 
      message: 'Sugestões geradas com sucesso',
      type: 'suggestions',
      suggestions: suggestions.split('\n').filter(line => line.trim())
    });
  } catch (error) {
    console.error('Erro ao gerar sugestões:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: 'Erro ao gerar sugestões',
      error: error.message
    });
  }
});

/**
 * @route POST /ai/report
 * @desc Gerar relatório de sessão
 * @access Privado
 */
router.post('/report', authenticate, async (req, res) => {
  try {
    const { sessionId, transcript } = req.body;
    
    // Validar dados obrigatórios
    if (!sessionId && !transcript) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'sessionId ou transcript são obrigatórios' 
      });
    }
    
    console.log(`Gerando relatório para sessão ${sessionId}`);
    
    // Importar o serviço OpenAI
    const openaiService = require('../services/ai/openai.service');
    
    // Se transcript não foi fornecido, buscar do banco de dados
    let finalTranscript = transcript;
    if (!finalTranscript && sessionId) {
      const transcriptions = await prisma.transcription.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' }
      });
      
      if (transcriptions.length > 0) {
        finalTranscript = transcriptions.map(t => t.content).join('\n\n');
      }
    }
    
    // Se não houver transcrição, retornar erro
    if (!finalTranscript) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Não há transcrição disponível para gerar relatório' 
      });
    }
    
    // Gerar relatório
    const report = await openaiService.generateReport(finalTranscript);
    
    return res.json({ 
      status: 'success', 
      message: 'Relatório gerado com sucesso',
      type: 'report',
      report
    });
  } catch (error) {
    console.error('Erro ao gerar relatório:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: 'Erro ao gerar relatório',
      error: error.message
    });
  }
});

// Middleware de teste que sempre adiciona um usuário fictício
const testAuthMiddleware = (req, res, next) => {
  console.log('Adicionando usuário de teste para a rota de transcrição');
  req.user = { id: 'test-user', name: 'Test User', role: 'CLIENT' };
  next();
};

// Garantir que o diretório tmp exista para arquivos temporários
const tmpDir = './tmp';
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
  console.log('Diretório tmp criado para arquivos temporários');
}

// Rota para transcrição de áudio com a API Whisper
router.post('/whisper/transcribe', 
  testAuthMiddleware,
  whisperUploadConfig.single('file'),
  async (req, res) => {
    try {
      // Verificar se um arquivo foi enviado
      if (!req.file) {
        console.log('Nenhum arquivo recebido na requisição para Whisper');
        return res.status(400).json({
          success: false,
          error: 'Nenhum arquivo de áudio foi enviado.'
        });
      }
      
      // Log detalhado do arquivo recebido
      console.log(`Arquivo recebido para Whisper: ${req.file.originalname}`);
      console.log(`Tipo MIME: ${req.file.mimetype}`);
      console.log(`Tamanho: ${req.file.size} bytes`);
      console.log(`Armazenamento: ${req.file.buffer ? 'Em memória (buffer)' : 'Em disco'}`);
      
      // Verificar se temos um buffer (armazenamento em memória)
      if (!req.file.buffer) {
        console.error('Erro: Arquivo recebido, mas sem buffer (configuração incorreta do multer)');
        return res.status(500).json({
          success: false,
          error: 'Erro de configuração do servidor: arquivo não disponível como buffer.'
        });
      }
      
      console.log(`Tamanho do buffer: ${req.file.buffer.length} bytes`);
      
      // Verificar o formato do áudio solicitado
      const format = req.body.format || 'json';
      const language = req.body.language || 'pt';
      console.log(`Parâmetros de transcrição: formato=${format}, idioma=${language}`);
      
      // Processar a transcrição com OpenAI
      console.log('Enviando áudio para transcrição via Whisper API...');
      const transcription = await openaiService.callWhisperAPI(req.file.buffer, {
        format,
        language
      });
      
      console.log('Transcrição concluída com sucesso!');
      
      // Verificar se temos texto na resposta
      if (!transcription || !transcription.text) {
        console.warn('API Whisper retornou resposta sem texto.');
        return res.status(422).json({
          success: false,
          error: 'A API de transcrição não retornou texto. O áudio pode estar vazio ou com problemas.'
        });
      }
      
      // Retornar o resultado
      return res.json({
        success: true,
        text: transcription.text
      });
    } catch (error) {
      console.error('Erro na transcrição Whisper:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Rota de upload de áudio para transcrição
router.post('/audio/transcribe', 
  audioUploadConfig.single('audio'),
  async (req, res) => {
    try {
      // Verificar se o arquivo existe
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Nenhum arquivo foi enviado'
        });
      }
      
      console.log(`Arquivo recebido: ${req.file.originalname}, tamanho: ${req.file.size} bytes`);
      
      // Se estiver usando armazenamento em disco, o arquivo estará em req.file.path
      // Se estiver usando armazenamento em memória, o arquivo estará em req.file.buffer
      let filePath = req.file.path;
      let useBuffer = false;
      
      // Se estiver usando buffer (memória)
      if (!filePath && req.file.buffer) {
        useBuffer = true;
        console.log('Usando dados do buffer para transcrição');
      }
      
      // Log de informações sobre o arquivo
      console.log(`Tipo de mídia: ${req.file.mimetype}`);
      console.log(`Caminho do arquivo: ${filePath || 'Em memória'}`);
      
      // Definir idioma da transcrição
      const language = req.body.language || 'pt';
      
      try {
        let transcription;
        
        if (useBuffer) {
          // Transcrição a partir do buffer em memória
          transcription = await openaiService.transcribeAudioFromBuffer(req.file.buffer, language);
        } else {
          // Transcrição a partir do arquivo em disco
          transcription = await openaiService.transcribeAudioVideo(filePath, language);
        }
        
        return res.status(200).json({
          success: true,
          transcription: transcription
        });
      } catch (error) {
        console.error('Erro na transcrição:', error);
        return res.status(500).json({
          success: false,
          message: 'Erro ao processar transcrição',
          error: error.message
        });
      }
    } catch (error) {
      console.error('Erro no endpoint de transcrição:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro interno no servidor',
        error: error.message
      });
    }
  }
);

// Rota para obter relatório de uso de tokens
router.get('/token-usage', aiController.getTokenUsage);

/**
 * @route GET /ai/openai-check
 * @desc Verificar se a API OpenAI está configurada corretamente
 * @access Privado
 */
router.get('/openai-check', authenticate, async (req, res) => {
  try {
    // Importar o serviço OpenAI
    const openaiService = require('../services/ai/openai.service');
    
    // Verificar se o serviço está inicializado
    if (!openaiService) {
      return res.status(500).json({ 
        status: 'error', 
        message: 'Serviço OpenAI não inicializado' 
      });
    }
    
    // Retornar status ok
    return res.json({ 
      status: 'success', 
      message: 'Serviço OpenAI inicializado com sucesso',
      version: 'gpt-4o-mini', // Versão padrão usada
      available: true
    });
  } catch (error) {
    console.error('Erro ao verificar API OpenAI:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: 'Erro ao verificar API OpenAI',
      error: error.message
    });
  }
});

/**
 * @route POST /ai/transcript
 * @desc Salvar transcrição de uma sessão
 * @access Privado
 */
router.post('/transcript', authenticate, async (req, res) => {
  try {
    const { sessionId, emotions } = req.body;
    
    // CORREÇÃO: Aceitar tanto 'transcript' quanto 'content' para compatibilidade
    const transcript = req.body.transcript || req.body.content || '';
    
    // Log detalhado para debug
    console.log(`AI Routes: Recebida requisição para salvar transcrição: sessionId=${sessionId}, tamanho=${transcript.length} caracteres`);
    console.log(`AI Routes: Campos recebidos:`, 
      Object.keys(req.body).map(k => `${k}=${typeof req.body[k] === 'string' ? req.body[k].substring(0, 30) + '...' : typeof req.body[k]}`).join(', ')
    );
    
    // Validar dados obrigatórios
    if (!sessionId || !transcript) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'sessionId e transcript/content são obrigatórios' 
      });
    }
    
    console.log(`Salvando transcrição para sessão ${sessionId}`);
    
    // Verificar se a sessão existe
    const session = await prisma.session.findUnique({
      where: { id: sessionId }
    });
    
    if (!session) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Sessão não encontrada' 
      });
    }
    
    // Salvar a transcrição no banco de dados
    const transcriptionRecord = await prisma.transcription.create({
      data: {
        sessionId,
        content: transcript,
        emotions: emotions ? JSON.stringify(emotions) : null,
        userId: req.user.id
      }
    });
    
    return res.json({ 
      status: 'success', 
      message: 'Transcrição salva com sucesso',
      transcription: transcriptionRecord
    });
  } catch (error) {
    console.error('Erro ao salvar transcrição:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: 'Erro ao salvar transcrição',
      error: error.message
    });
  }
});

module.exports = router; 