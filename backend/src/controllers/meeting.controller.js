/**
 * Controlador para gerenciar videoconferências
 * 
 * Este controlador lida com a criação, configuração e gerenciamento
 * de sessões de videoconferência usando o serviço do Daily.co
 */

const dailyService = require('../services/daily.service');
const prisma = require('../utils/prisma');

/**
 * Controlador para gerenciar videoconferências com Daily.co
 */
const meetingController = {
  /**
   * Cria uma reunião/sessão no Daily.co
   * @param {Request} req - Requisição Express
   * @param {Response} res - Resposta Express
   */
  createMeeting: async (req, res) => {
    try {
      const { roomName, provider = 'daily' } = req.body;
      
      // Verificar se há um usuário logado (req.user é inserido pelo middleware de auth)
      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
      }
      
      // Verificar se o usuário é um terapeuta
      if (req.user.role !== 'THERAPIST') {
        return res.status(403).json({ 
          error: 'Acesso negado', 
          message: 'Apenas terapeutas podem criar salas de videoconferência' 
        });
      }
      
      // Gerar identificador único para a sessão se não fornecido
      const sessionId = roomName || `session-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      
      // Gerar um nome curto para a sala baseado no sessionId (máximo 10 caracteres)
      // Remover prefixo 'tc-' se existir
      let cleanSessionId = sessionId;
      if (sessionId.startsWith('tc-')) {
        cleanSessionId = sessionId.substring(3);
      }
      
      // Limitar a 10 caracteres e sanitizar
      const shortRoomName = cleanSessionId.substring(0, 10).replace(/[^a-zA-Z0-9-]/g, '');
      
      console.log(`Criando reunião. Provider: ${provider}, sessionId: ${sessionId}, shortRoomName: ${shortRoomName}`);
      
      let roomData = {};
      let url = '';
      
      // Criar sala no Daily.co
      const dailyRoom = await dailyService.validateAndGetRoom(shortRoomName);
      url = dailyRoom.url;
      roomData = {
        dailyRoomName: dailyRoom.name,
        dailyRoomUrl: dailyRoom.url
      };
      console.log('Sala Daily.co criada:', dailyRoom);
      
      // Registrar a reunião no banco de dados
      try {
        // Verificar se o modelo Session existe no Prisma
        if (!prisma || !prisma.session) {
          console.error('Erro: Objeto prisma ou prisma.session não está disponível');
          return res.status(500).json({ 
            error: 'Erro interno ao tentar acessar o banco de dados',
            details: 'O cliente Prisma não foi inicializado corretamente'
          });
        }
        
        // Buscar ou criar um cliente e terapeuta dummy para testes
        // Nota: Em produção, você deve usar IDs reais
        const dummyTherapistId = await getDummyTherapistId();
        const dummyClientId = await getDummyClientId();
        const dummyAppointmentId = await getDummyAppointmentId(dummyTherapistId, dummyClientId);
        
        if (!dummyTherapistId || !dummyClientId || !dummyAppointmentId) {
          return res.status(500).json({ 
            error: 'Não foi possível criar sessão: faltam referências necessárias',
            details: 'Terapeuta, cliente ou agendamento não encontrados'
          });
        }
        
        // Criar a sessão usando o modelo Session
        const session = await prisma.session.create({
          data: {
            title: `Sessão ${shortRoomName}`,
            scheduledDuration: 60, // 60 minutos por padrão
            appointmentId: dummyAppointmentId,
            therapistId: dummyTherapistId,
            clientId: dummyClientId,
            dyteMeetingId: dailyRoom.name,
            dyteRoomName: dailyRoom.url,
            status: 'SCHEDULED'
          }
        });
        
        console.log(`Sessão criada no banco, ID: ${session.id}, URL: ${url}`);
        
        return res.status(201).json({
          id: session.id,
          sessionId,
          url,
          provider
        });
      } catch (dbError) {
        console.error('Erro ao salvar sessão no banco de dados:', dbError);
        
        // Incluir informações de depuração
        console.log('Dados que tentamos salvar:', {
          sessionId,
          dailyRoom
        });
        
        // Como já criamos a sala no Daily, retornar informações básicas mesmo com erro de BD
        return res.status(201).json({
          message: 'Sala criada no Daily.co, mas não foi possível registrar no banco de dados',
          sessionId,
          url,
          provider,
          error: dbError.message
        });
      }
    } catch (error) {
      console.error('Erro ao criar reunião:', error);
      return res.status(500).json({ error: 'Erro ao criar reunião: ' + error.message });
    }
  },

  /**
   * Adiciona um participante à reunião
   * @param {Request} req - Requisição Express
   * @param {Response} res - Resposta Express
   */
  joinMeeting: async (req, res) => {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ message: 'ID da sessão é obrigatório' });
      }

      // Buscar a sessão no banco de dados
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
          therapist: {
            include: {
              user: true
            }
          },
          client: {
            include: {
              user: true
            }
          },
          appointment: true
        }
      });

      if (!session) {
        return res.status(404).json({ message: 'Sessão não encontrada' });
      }

      // Verificar se existe uma reunião criada
      if (!session.dyteMeetingId || !session.dyteRoomName) {
        // Se não existir, verificar se o usuário atual é o terapeuta
        // Apenas terapeutas podem criar salas
        if (session.therapist.userId !== req.user.id) {
          return res.status(403).json({ 
            message: 'A sala de videoconferência ainda não foi criada. Apenas o terapeuta pode iniciar a sessão.' 
          });
        }
        
        // Processar o ID para garantir compatibilidade com Daily.co
        let shortId = sessionId;
        
        // Remover prefixo 'tc-' se existir
        if (shortId.startsWith('tc-')) {
          shortId = shortId.substring(3);
        }
        
        // Limitar a 10 caracteres
        shortId = shortId.substring(0, 10);
        
        // Sanitizar (remover caracteres não permitidos)
        shortId = shortId.replace(/[^a-zA-Z0-9-]/g, '');
        
        console.log('ID de sala processado para Daily.co:', shortId, 'Original:', sessionId);
        
        // Criar sala usando o ID sanitizado
        const dailyRoom = await dailyService.createRoom(shortId, 2);
        
        // Atualizar a sessão com os dados da nova sala
        await prisma.$executeRawUnsafe(`
          UPDATE "Session"
          SET "dyteMeetingId" = '${dailyRoom.name}',
              "dyteRoomName" = '${dailyRoom.url}'
          WHERE id = '${sessionId}'
        `);
        
        // Atualizar os dados da sessão na memória
        session.dyteMeetingId = dailyRoom.name;
        session.dyteRoomName = dailyRoom.url;
      }

      // Verificar se o usuário atual é o terapeuta ou cliente envolvido
      const userId = req.user.id;
      const currentUser = req.user;
      const isTherapist = session.therapist.userId === userId;
      const isClient = session.client.userId === userId;

      if (!isTherapist && !isClient) {
        return res.status(403).json({ message: 'Não autorizado a participar desta reunião' });
      }
      
      // Verificar se o agendamento está confirmado ou agendado (permitir ambos para testes)
      if (session.appointment && 
          session.appointment.status !== 'CONFIRMED' && 
          session.appointment.status !== 'SCHEDULED') {
        return res.status(403).json({ 
          message: 'Não é possível acessar a sala: o agendamento não está confirmado ou agendado' 
        });
      }
      
      // Verificar horário da sessão se for cliente
      if (isClient) {
        // Obter horário atual
        const now = new Date();
        
        // Verificar se o agendamento existe
        if (!session.appointment) {
          return res.status(403).json({ 
            message: 'Não é possível acessar a sala: agendamento não encontrado' 
          });
        }
        
        // Verificar se a sessão está programada para agora (com tolerância de 5 min)
        const appointmentTime = new Date(session.appointment.dateTime);
        const sessionEndTime = new Date(appointmentTime.getTime() + (session.scheduledDuration * 60000));
        
        // Permitir acesso 24 horas (1440 minutos) antes do horário agendado (para testes)
        const earlyAccess = new Date(appointmentTime.getTime() - 1440 * 60000);
        
        // Se o cliente estiver tentando acessar fora do horário permitido
        if (now < earlyAccess || now > sessionEndTime) {
          return res.status(403).json({ 
            message: 'Acesso negado: você só pode entrar na sala a partir de 24 horas antes do horário agendado' 
          });
        }
      }

      // Definir o papel com base em quem está entrando
      const role = isTherapist ? 'host' : 'participant';
      
      // Gerar um token para o participante (opcional, para acesso seguro)
      const tokenResult = await dailyService.createMeetingToken(session.dyteMeetingId, {
        userName: currentUser.name,
        userId: userId,
        isOwner: isTherapist,
        startAudioOff: false,
        startVideoOff: false
      });
      
      // Extrair apenas o nome da sala sem o domínio
      let roomUrl = session.dyteRoomName;
      
      // Substituir possíveis prefixos tc- na URL final
      roomUrl = roomUrl.replace('/tc-', '/');
      
      console.log('URL final para o cliente:', roomUrl);

      // Para compatibilidade com o cliente existente, retornamos o mesmo formato
      res.status(200).json({
        message: 'Token de participante gerado com sucesso',
        authToken: tokenResult.token,
        meetingId: session.dyteMeetingId,
        roomName: roomUrl,
        domain: 'teraconect.daily.co',
        // Informações sobre o usuário
        userName: currentUser.name,
        userId: userId,
        userRole: role,
        isHost: isTherapist
      });
    } catch (error) {
      console.error('Erro ao entrar na reunião:', error);
      res.status(500).json({ message: 'Erro ao entrar na reunião', error: error.message });
    }
  },

  /**
   * Encerra uma reunião ativa
   * @param {Request} req - Requisição Express
   * @param {Response} res - Resposta Express
   */
  endMeeting: async (req, res) => {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ message: 'ID da sessão é obrigatório' });
      }

      // Buscar a sessão no banco de dados
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
          therapist: true
        }
      });

      if (!session) {
        return res.status(404).json({ message: 'Sessão não encontrada' });
      }

      if (!session.dyteMeetingId) {
        return res.status(400).json({ message: 'Nenhuma reunião ativa para esta sessão' });
      }

      // Verificar se o usuário atual é o terapeuta
      const userId = req.user.id;
      if (session.therapist.userId !== userId) {
        return res.status(403).json({ message: 'Apenas o terapeuta pode encerrar a reunião' });
      }

      // Encerrar a reunião no Daily.co
      await dailyService.deleteRoom(session.dyteMeetingId);

      // Atualizar a sessão no banco de dados
      await prisma.$executeRawUnsafe(`
        UPDATE "Session"
        SET "dyteMeetingId" = NULL,
            "dyteRoomName" = NULL
        WHERE id = '${sessionId}'
      `);

      res.status(200).json({ message: 'Reunião encerrada com sucesso' });
    } catch (error) {
      console.error('Erro ao encerrar reunião:', error);
      res.status(500).json({ message: 'Erro ao encerrar reunião', error: error.message });
    }
  },

  /**
   * Obtém o status de uma reunião
   * @param {Request} req - Requisição Express
   * @param {Response} res - Resposta Express
   */
  getMeetingStatus: async (req, res) => {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ message: 'ID da sessão é obrigatório' });
      }

      // Buscar a sessão no banco de dados
      const session = await prisma.session.findUnique({
        where: { id: sessionId }
      });

      if (!session) {
        return res.status(404).json({ message: 'Sessão não encontrada' });
      }

      // Verificar se o usuário atual tem permissão para ver a sessão
      const userId = req.user.id;
      const isTherapist = session.therapistId && await prisma.therapist.findFirst({
        where: { id: session.therapistId, userId }
      });
      const isClient = session.clientId && await prisma.client.findFirst({
        where: { id: session.clientId, userId }
      });

      if (!isTherapist && !isClient) {
        return res.status(403).json({ message: 'Não autorizado a ver esta sessão' });
      }

      if (!session.dyteMeetingId) {
        return res.json({
          active: false,
          message: 'Nenhuma reunião ativa para esta sessão'
        });
      }

      // Verificar o status da reunião no Daily.co
      const roomStatus = await dailyService.getRoomStatus(session.dyteMeetingId);

      return res.json({
        active: roomStatus.exists,
        url: session.dyteRoomName,
        roomName: session.dyteMeetingId,
        created: roomStatus.created,
        expires: roomStatus.expires,
        message: roomStatus.exists ? 'Reunião ativa' : 'Reunião não existe ou expirou'
      });
    } catch (error) {
      console.error('Erro ao verificar status da reunião:', error);
      res.status(500).json({ message: 'Erro ao verificar status da reunião', error: error.message });
    }
  }
};

// Função auxiliar para obter um ID de terapeuta válido para testes
async function getDummyTherapistId() {
  try {
    // Tentar encontrar um terapeuta existente
    const therapist = await prisma.therapist.findFirst();
    
    if (therapist) {
      return therapist.id;
    }
    
    console.log('Nenhum terapeuta encontrado, considerando apenas a sala do Daily.co');
    return null;
  } catch (error) {
    console.error('Erro ao buscar terapeuta:', error);
    return null;
  }
}

// Função auxiliar para obter um ID de cliente válido para testes
async function getDummyClientId() {
  try {
    // Tentar encontrar um cliente existente
    const client = await prisma.client.findFirst();
    
    if (client) {
      return client.id;
    }
    
    console.log('Nenhum cliente encontrado, considerando apenas a sala do Daily.co');
    return null;
  } catch (error) {
    console.error('Erro ao buscar cliente:', error);
    return null;
  }
}

// Função auxiliar para obter um ID de agendamento válido para testes
async function getDummyAppointmentId(therapistId, clientId) {
  if (!therapistId || !clientId) return null;
  
  try {
    // Tentar encontrar um agendamento existente entre este terapeuta e cliente
    const appointment = await prisma.appointment.findFirst({
      where: {
        therapistId,
        clientId
      }
    });
    
    if (appointment) {
      return appointment.id;
    }
    
    // Se não existir, criar um novo agendamento
    const today = new Date();
    const toolId = await getDefaultToolId();
    
    if (!toolId) {
      console.log('Nenhuma ferramenta encontrada, não é possível criar agendamento');
      return null;
    }
    
    const newAppointment = await prisma.appointment.create({
      data: {
        therapistId,
        clientId,
        date: today.toISOString().split('T')[0],
        time: '12:00',
        duration: 60,
        toolId,
        mode: 'ONLINE',
        price: 0,
        status: 'SCHEDULED'
      }
    });
    
    console.log('Novo agendamento criado para a sessão:', newAppointment.id);
    return newAppointment.id;
  } catch (error) {
    console.error('Erro ao buscar/criar agendamento:', error);
    return null;
  }
}

// Função para obter ID de uma ferramenta de atendimento
async function getDefaultToolId() {
  try {
    // Tentar encontrar uma ferramenta existente
    const tool = await prisma.tool.findFirst();
    
    if (tool) {
      return tool.id;
    }
    
    console.log('Nenhuma ferramenta encontrada');
    return null;
  } catch (error) {
    console.error('Erro ao buscar ferramenta:', error);
    return null;
  }
}

module.exports = meetingController; 