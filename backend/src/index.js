/**
 * Arquivo principal do servidor
 * 
 * Comandos para instalar dependências:
 * New-Item -ItemType Directory -Path backend
 * Set-Location backend
 * npm init -y
 * npm install express cors jsonwebtoken bcryptjs dotenv morgan body-parser nodemon @prisma/client
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const path = require('path');
const prisma = require('./utils/prisma');
const http = require('http');
const socketIo = require('socket.io');

// Importação das rotas
const authRoutes = require('./routes/auth.routes');
const therapistRoutes = require('./routes/therapist.routes');
const clientRoutes = require('./routes/client.routes');
const appointmentRoutes = require('./routes/appointment.routes');
const userRoutes = require('./routes/user.routes');
const toolRoutes = require('./routes/tool.routes');
const uploadRoutes = require('./routes/upload.routes');
const sessionRoutes = require('./routes/session.routes');
const aiRoutes = require('./routes/ai.routes');
const transcriptRoutes = require('./routes/transcript.routes');
const insightRoutes = require('./routes/insight.routes');
const meetingRoutes = require('./routes/meeting.routes');
const trainingRoutes = require('./routes/training.routes');
const transcriptionRoutes = require('./routes/transcription.routes');
const webrtcRoutes = require('./routes/webrtc.routes');

// Carregar explicitamente o serviço OpenAI no início
const openaiService = require('./services/ai/openai.service');
console.log('OpenAI Service importado explicitamente no index.js');

// Verificar se o serviço foi carregado corretamente
if (openaiService) {
  console.log('OpenAI Service: Objeto do serviço carregado com sucesso');
} else {
  console.error('ERRO: Falha ao carregar o serviço OpenAI');
}

// Configuração da aplicação
const app = express();
const PORT = process.env.PORT || 3000;

// Criar servidor HTTP com Express
const server = http.createServer(app);

// Configurar Socket.IO com configurações otimizadas
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? ['https://terapiaconect.com', 'https://www.terapiaconect.com', 'https://terapia-conect-frontend.vercel.app', 'https://terapia-conect-frontend-git-main-rodrigodebrito.vercel.app'] 
      : ['http://localhost:3001', 'http://localhost:5173', '*'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With']
  },
  allowEIO3: true, // Compatibilidade com Engine.IO versão 3
  pingTimeout: 60000, // Aumentar timeout para prevenir desconexões
  transports: ['polling', 'websocket'] // Permitir ambos polling e websocket
});

// Configuração de debug para Socket.IO
io.engine.on('connection_error', (err) => {
  console.error('Socket.IO connection error:', err);
});

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://terapiaconect.com', 'https://www.terapiaconect.com', 'https://terapia-conect-frontend.vercel.app', 'https://terapia-conect-frontend-git-main-rodrigodebrito.vercel.app'] 
    : ['http://localhost:3001', 'http://localhost:5173', '*'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'x-requested-with', 'X-Test-Auth']
}));

// Adicionar middleware de CORS específico para garantir header cors em todas as respostas
app.use((req, res, next) => {
  // Definir cabeçalhos CORS para cada resposta
  const allowedOrigins = process.env.NODE_ENV === 'production' 
    ? ['https://terapiaconect.com', 'https://www.terapiaconect.com', 'https://terapia-conect-frontend.vercel.app', 'https://terapia-conect-frontend-git-main-rodrigodebrito.vercel.app'] 
    : ['http://localhost:3001', 'http://localhost:5173'];
    
  const origin = req.headers.origin;
  
  // Verificar se a origem está na lista de permitidos ou usar '*' em desenvolvimento
  if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, x-requested-with, X-Test-Auth');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  
  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// Servir arquivos estáticos da pasta uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Definição das rotas
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/therapists', therapistRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/tools', toolRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/transcripts', transcriptRoutes);
app.use('/api/insights', insightRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/training', trainingRoutes);
app.use('/api/transcription', transcriptionRoutes);
app.use('/api/webrtc', webrtcRoutes);

// Rota padrão
app.get('/', (req, res) => {
  res.send('API da Plataforma Terapeuta - Versão 1.0.0');
});

// Configuração do Socket.IO
io.on('connection', (socket) => {
  console.log('Novo cliente conectado:', socket.id);
  
  // Evento quando um cliente entra numa sala
  socket.on('join-room', async (roomId) => {
    try {
      // Validar o ID da sala
      if (!roomId) {
        console.error('Tentativa de entrar em sala com ID nulo');
        return;
      }
      
      console.log(`Cliente ${socket.id} entrou na sala: ${roomId}`);
      
      // Adicionar o cliente à sala
      socket.join(roomId);
      
      // Emitir evento para informar que um usuário entrou
      socket.to(roomId).emit('user-joined', { 
        socketId: socket.id,
        timestamp: Date.now()
      });
      
      // NOVO: Registrar o participante explicitamente no WebRTC
      try {
        const webRTCService = require('./services/media/webrtc.service');
        await webRTCService.registerParticipant(roomId, socket.id);
        console.log(`Cliente ${socket.id} registrado como participante na sessão WebRTC ${roomId}`);
      } catch (webrtcError) {
        console.error(`Erro ao registrar participante no WebRTC: ${webrtcError.message}`);
        // Não interrompemos o fluxo se falhar o registro no WebRTC
      }
    } catch (error) {
      console.error(`Erro ao processar entrada na sala: ${error.message}`);
    }
  });
  
  // Manipular eventos de gravação de áudio
  socket.on('recording-event', (data) => {
    if (data && data.sessionId && data.type) {
      console.log(`[${socket.id}] Evento de gravação recebido: ${data.type} para sessão ${data.sessionId}`);
      
      // Repassar o evento para todos na sala, exceto o remetente
      if (data.type === 'start') {
        socket.to(data.sessionId).emit('recording-start', {
          sessionId: data.sessionId,
          timestamp: data.timestamp || Date.now()
        });
      } else if (data.type === 'stop') {
        socket.to(data.sessionId).emit('recording-stop', {
          sessionId: data.sessionId,
          timestamp: data.timestamp || Date.now()
        });
      }
    }
  });
  
  // Manipular sinalização WebRTC
  socket.on('webrtc-signal', (data) => {
    if (data && data.sessionId) {
      console.log(`[${socket.id}] Sinalização WebRTC para sessão ${data.sessionId}: ${data.type}`);
      
      // Repassar a sinalização para todos os outros na sala
      if (data.targetId) {
        // Sinalização direcionada para um cliente específico
        socket.to(data.targetId).emit('webrtc-signal', {
          ...data,
          sourceId: socket.id,
          timestamp: Date.now()
        });
      } else {
        // Broadcast para todos na sala exceto o remetente
        socket.to(data.sessionId).emit('webrtc-signal', {
          ...data,
          sourceId: socket.id,
          timestamp: Date.now()
        });
      }
    }
  });
  
  // Evento para informar estado de WebRTC
  socket.on('webrtc-ready', (data) => {
    if (data && data.sessionId) {
      console.log(`[${socket.id}] Cliente WebRTC pronto na sessão ${data.sessionId}`);
      
      // Informar outros na sala
      socket.to(data.sessionId).emit('webrtc-peer-ready', {
        peerId: socket.id,
        sessionId: data.sessionId,
        timestamp: Date.now()
      });
    }
  });
  
  // Evento para solicitação de transcrição via WebRTC
  socket.on('webrtc-transcribe-request', (data) => {
    if (data && data.sessionId) {
      console.log(`[${socket.id}] Solicitação de transcrição WebRTC para sessão ${data.sessionId}`);
      
      // Informar outros na sala
      socket.to(data.sessionId).emit('webrtc-transcribe-request', {
        peerId: socket.id,
        sessionId: data.sessionId,
        timestamp: Date.now()
      });
    }
  });
  
  // Manipular rotação específica de representantes
  socket.on('representative_rotated', (data) => {
    if (data && data.sessionId && data.representativeId) {
      // Garantir que a rotação seja um número
      const numericRotation = typeof data.rotation === 'object' ? data.rotation.y || 0 : Number(data.rotation);
      
      console.log(`[${socket.id}] Rotação de representante recebida para ID ${data.representativeId} na sessão ${data.sessionId}: ${numericRotation}`);
      
      // Atualizar a rotação com valor numérico garantido
      const eventData = {
        ...data,
        rotation: numericRotation,
        forwardedBy: socket.id,
        timestamp: Date.now()
      };
      
      // Repassar a rotação para todos na mesma sala, exceto o remetente
      socket.to(data.sessionId).emit('representative_rotated', eventData);
    }
  });
  
  // Manipular sincronização completa de representantes
  socket.on('representatives_updated', (data) => {
    if (data && data.sessionId && data.representatives) {
      console.log(`[${socket.id}] Atualização completa de representantes para sessão ${data.sessionId}: ${data.representatives.length} representantes`);
      
      // Repassar a atualização para todos na mesma sala, exceto o remetente
      socket.to(data.sessionId).emit('representatives_updated', {
        ...data,
        forwardedBy: socket.id,
        timestamp: Date.now()
      });
    }
  });
  
  // Manipular comandos de constelação
  socket.on('constellation-command', (data) => {
    if (data && data.sessionId) {
      console.log(`Comando de constelação recebido: ${data.type} para sessão ${data.sessionId}`);
      
      // Repassar o comando para todos na mesma sala, exceto o remetente
      socket.to(data.sessionId).emit('constellation-command', data);
    }
  });
  
  // Manipular comandos de objetos de constelação (posicionamento, etc)
  socket.on('constellation-object', (data) => {
    if (data && data.sessionId) {
      try {
        // Verificar se o remetente está na sala
        const rooms = Array.from(socket.rooms);
        if (!rooms.includes(data.sessionId)) {
          console.log(`[${socket.id}] Socket não está na sala ${data.sessionId}, associando agora`);
          socket.join(data.sessionId);
        }

        // Adicionar logs detalhados para diferentes tipos de eventos
        if (data.type === 'plate') {
          console.log(`[${socket.id}] Atualização de rotação do prato para sessão ${data.sessionId}: ${data.rotation.toFixed(2)}`);
          
          // Verificar se precisamos forçar a atualização mesmo para quem tem controle
          if (data.forceUpdate) {
            console.log(`[${socket.id}] Forçando atualização de rotação do prato para todos`);
            // Enviar para todos na sala incluindo quem enviou
            io.to(data.sessionId).emit('constellation-object', {
              ...data,
              forwardedBy: socket.id,
              timestamp: Date.now()
            });
          } else {
            // Repassar somente para os outros na sala
            socket.to(data.sessionId).emit('constellation-object', {
              ...data,
              forwardedBy: socket.id,
              timestamp: Date.now()
            });
          }
        } 
        else if (data.type === 'camera') {
          console.log(`[${socket.id}] Atualização de câmera para sessão ${data.sessionId}: Pos(${data.position.x.toFixed(1)}, ${data.position.y.toFixed(1)}, ${data.position.z.toFixed(1)})`);
          
          // Verificar se precisamos forçar a atualização mesmo para quem tem controle
          if (data.forceUpdate) {
            console.log(`[${socket.id}] Forçando atualização de câmera para todos`);
            // Enviar para todos na sala incluindo quem enviou
            io.to(data.sessionId).emit('constellation-object', {
              ...data,
              forwardedBy: socket.id,
              timestamp: Date.now()
            });
          } else {
            // Repassar somente para os outros na sala
            socket.to(data.sessionId).emit('constellation-object', {
              ...data,
              forwardedBy: socket.id,
              timestamp: Date.now()
            });
          }
        }
        else if (data.type === 'representative') {
          console.log(`[${socket.id}] Evento de representante para sessão ${data.sessionId} - ação: ${data.action}, ID: ${data.representative?.id || data.representativeId}`);
          
          // Repassar o comando para todos na mesma sala, exceto o remetente
          socket.to(data.sessionId).emit('constellation-object', {
            ...data,
            forwardedBy: socket.id,
            timestamp: Date.now()
          });
        } 
        else if (data.type === 'requestSync') {
          console.log(`[${socket.id}] Cliente solicitou sincronização para sessão ${data.sessionId}`);
          
          // Emitir um evento para o host da sessão pedindo para enviar a sincronização
          socket.to(data.sessionId).emit('constellation-sync-request', {
            clientId: data.clientId,
            sessionId: data.sessionId,
            timestamp: Date.now()
          });
        } 
        else if (data.type === 'fullSync') {
          console.log(`[${socket.id}] Sincronização completa para sessão ${data.sessionId} - ${data.representatives?.length || 0} representantes`);
          
          // Encaminhar para todos na sala, incluindo quem solicitou
          io.to(data.sessionId).emit('constellation-object', {
            ...data,
            forwardedBy: socket.id,
            timestamp: Date.now()
          });
        } 
        else if (data.type === 'control') {
          console.log(`[${socket.id}] Evento de controle para sessão ${data.sessionId} - ação: ${data.action}`);
          
          // Encaminhar para todos na sala
          io.to(data.sessionId).emit('constellation-object', {
            ...data,
            forwardedBy: socket.id,
            timestamp: Date.now()
          });
        }
        else {
          console.log(`[${socket.id}] Atualização de objeto de constelação para sessão ${data.sessionId} - tipo: ${data.type}, ação: ${data.action || 'none'}`);
          
          // Repassar o comando para todos na mesma sala, exceto o remetente
          socket.to(data.sessionId).emit('constellation-object', {
            ...data,
            forwardedBy: socket.id,
            timestamp: Date.now()
          });
        }
      } catch (error) {
        console.error(`Erro ao processar evento constellation-object:`, error);
      }
    }
  });
  
  // Manipular desconexão do cliente
  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// Iniciar o servidor com socket.io
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT} com suporte a Socket.IO`);
});

// Middleware para tratar erros do Prisma
app.use((err, req, res, next) => {
  // Tratamento específico para erros do Multer
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        message: 'O arquivo é muito grande. O tamanho máximo permitido é 10MB.'
      });
    }
    
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        message: 'Campo de arquivo inesperado.'
      });
    }
    
    return res.status(400).json({
      message: `Erro no upload de arquivo: ${err.message}`
    });
  }

  if (err.name === 'PrismaClientKnownRequestError') {
    console.error('Erro de Prisma:', err.message);
    return res.status(400).json({ message: 'Erro na operação do banco de dados', code: err.code });
  }
  
  if (err.name === 'PrismaClientValidationError') {
    console.error('Erro de validação do Prisma:', err.message);
    return res.status(400).json({ message: 'Erro de validação nos dados fornecidos' });
  }
  
  console.error('Erro não tratado:', err);
  res.status(500).json({ message: 'Erro interno do servidor' });
});

// Graceful shutdown
process.on('SIGTERM', shutDown);
process.on('SIGINT', shutDown);

async function shutDown() {
  console.log('Recebido sinal para encerramento');
  
  server.close(() => {
    console.log('Servidor HTTP fechado');
  });
  
  try {
    await prisma.$disconnect();
    console.log('Conexão com o banco de dados fechada');
    process.exit(0);
  } catch (error) {
    console.error('Erro ao desconectar do banco de dados:', error);
    process.exit(1);
  }
}

// Para testes
module.exports = app; 