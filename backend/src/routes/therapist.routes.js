/**
 * Rotas para terapeutas
 */

const express = require('express');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const prisma = require('../utils/prisma');
const {
  getAllTherapists,
  getTherapistById,
  getTherapistAvailability,
  updateTherapistAvailability,
  updateTherapistProfile,
  getTherapistByUserId,
  createTherapist,
  uploadProfilePicture
} = require('../controllers/therapist.controller');
const upload = require('../utils/multer');
const { startOfDay, endOfDay } = require('date-fns');

const router = express.Router();

/**
 * @route GET /therapists
 * @desc Obter lista de terapeutas com filtros
 * @access Público
 */
router.get('/', async (req, res) => {
  try {
    const {
      attendanceMode,
      maxPrice,
      minPrice,
      targetAudience,
      offersFreeSession,
      searchTerm
    } = req.query;

    console.log('Parâmetros de busca:', { attendanceMode, maxPrice, minPrice, targetAudience, offersFreeSession, searchTerm });

    // Construir o objeto de filtros para o Prisma
    const where = {
      // Removendo o filtro de aprovação para teste
      // isApproved: true,
    };

    // Filtro por modo de atendimento
    if (attendanceMode && attendanceMode !== 'ALL') {
      where.attendanceMode = attendanceMode;
    }

    // Filtro por preço
    if (maxPrice || minPrice) {
      where.baseSessionPrice = {};
      if (maxPrice) where.baseSessionPrice.lte = parseFloat(maxPrice);
      if (minPrice) where.baseSessionPrice.gte = parseFloat(minPrice);
    }

    // Filtro por público-alvo
    if (targetAudience) {
      where.targetAudience = {
        contains: targetAudience,
        mode: 'insensitive'
      };
    }

    // Filtro por sessão gratuita
    if (offersFreeSession === 'true') {
      where.offersFreeSession = true;
    }

    // Busca por termo (nome, bio, especialidades)
    if (searchTerm) {
      where.OR = [
        {
          user: {
            name: {
              contains: searchTerm,
              mode: 'insensitive'
            }
          }
        },
        {
          shortBio: {
            contains: searchTerm,
            mode: 'insensitive'
          }
        },
        {
          niches: {
            contains: searchTerm,
            mode: 'insensitive'
          }
        },
        {
          targetAudience: {
            contains: searchTerm,
            mode: 'insensitive'
          }
        }
      ];
    }

    console.log('Condições de busca:', JSON.stringify(where, null, 2));

    const therapists = await prisma.therapist.findMany({
      where,
      include: {
        user: {
          select: {
            name: true,
            email: true
          }
        },
        _count: {
          select: {
            appointments: true // Para contar número de atendimentos
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    console.log(`Encontrados ${therapists.length} terapeutas.`);
    if (therapists.length > 0) {
      console.log('Primeiro terapeuta:', {
        id: therapists[0].id,
        name: therapists[0].user.name,
        isApproved: therapists[0].isApproved,
        baseSessionPrice: therapists[0].baseSessionPrice
      });
    }

    // Mapear os resultados para o formato esperado pelo frontend
    const mappedTherapists = therapists.map(therapist => ({
      id: therapist.id,
      name: therapist.user.name,
      email: therapist.user.email, // Adicionado para debug
      isApproved: therapist.isApproved,
      profilePicture: therapist.profilePicture,
      attendanceMode: therapist.attendanceMode,
      shortBio: therapist.shortBio,
      baseSessionPrice: therapist.baseSessionPrice,
      sessionDuration: therapist.sessionDuration,
      niches: therapist.niches,
      targetAudience: therapist.targetAudience,
      offersFreeSession: therapist.offersFreeSession,
      freeSessionDuration: therapist.freeSessionDuration,
      city: therapist.city,
      state: therapist.state,
      rating: therapist.rating || 0,
      reviewCount: therapist._count.appointments || 0
    }));

    console.log(`Retornando ${mappedTherapists.length} terapeutas mapeados.`);
    res.json(mappedTherapists);
  } catch (error) {
    console.error('Erro ao buscar terapeutas:', error);
    res.status(500).json({ message: 'Erro ao buscar terapeutas' });
  }
});

/**
 * @route GET /therapists/profile
 * @desc Obter perfil do terapeuta logado
 * @access Privado (apenas terapeutas)
 */
router.get('/profile', authenticate, authorize(['THERAPIST']), async (req, res) => {
  try {
    const therapist = await prisma.therapist.findUnique({
      where: { userId: req.user.id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });
    
    if (!therapist) {
      return res.status(404).json({ message: 'Perfil de terapeuta não encontrado' });
    }
    
    // Mapear para o formato esperado pela API
    const mappedTherapist = {
      id: therapist.id,
      userId: therapist.userId,
      name: therapist.user.name,
      email: therapist.user.email,
      shortBio: therapist.shortBio,
      niches: therapist.niches,
      customNiches: therapist.customNiches,
      tools: therapist.tools,
      customTools: therapist.customTools,
      education: therapist.education,
      experience: therapist.experience,
      targetAudience: therapist.targetAudience,
      differential: therapist.differential,
      baseSessionPrice: therapist.baseSessionPrice,
      servicePrices: therapist.servicePrices,
      sessionDuration: therapist.sessionDuration,
      profilePicture: therapist.profilePicture,
      isApproved: therapist.isApproved
    };
    
    return res.json(mappedTherapist);
  } catch (error) {
    console.error('Erro ao buscar perfil do terapeuta:', error);
    return res.status(500).json({ message: 'Erro ao buscar dados do terapeuta' });
  }
});

/**
 * @route GET /therapists/user/:userId
 * @desc Obter terapeuta pelo ID do usuário
 * @access Privado
 */
router.get('/user/:userId', authenticate, getTherapistByUserId);

/**
 * @route POST /therapists
 * @desc Criar novo perfil de terapeuta
 * @access Privado (apenas usuários com papel THERAPIST)
 */
router.post('/', authenticate, authorize(['THERAPIST']), createTherapist);

/**
 * @route GET /therapists/:id
 * @desc Rota para obter detalhes de um terapeuta
 * @access Público
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('DEBUG: Buscando detalhes públicos do terapeuta:', id);

    // Verificar se o terapeuta tem ferramentas
    const toolCount = await prisma.therapistTool.count({
      where: { therapistId: id }
    });

    const therapist = await prisma.therapist.findUnique({
      where: { id },
      include: {
        user: true,
        tools: {
          include: {
            tool: true
          }
        },
        availability: true,
      }
    });

    if (!therapist) {
      return res.status(404).json({ error: 'Terapeuta não encontrado' });
    }

    // Formatar os dados para o frontend
    const formattedTherapist = {
      id: therapist.id,
      user: {
        id: therapist.user.id,
        name: therapist.user.name,
        email: therapist.user.email,
      },
      name: therapist.user.name,
      shortBio: therapist.shortBio,
      bio: therapist.bio,
      niches: therapist.niches,
      education: therapist.education,
      experience: therapist.experience,
      targetAudience: therapist.targetAudience,
      differential: therapist.differential,
      baseSessionPrice: therapist.baseSessionPrice,
      sessionDuration: therapist.sessionDuration,
      profilePicture: therapist.profilePicture,
      isApproved: therapist.isApproved,
      attendanceMode: therapist.attendanceMode,
      address: therapist.address,
      neighborhood: therapist.neighborhood,
      city: therapist.city,
      state: therapist.state,
      zipCode: therapist.zipCode,
      offersFreeSession: therapist.offersFreeSession,
      freeSessionDuration: therapist.freeSessionDuration,
      tools: therapist.tools.map(tt => ({
        id: tt.tool.id,
        name: tt.tool.name,
        description: tt.tool.description || '',
        duration: tt.duration,
        price: tt.price
      })),
      availability: therapist.availability,
    };

    res.json(formattedTherapist);
  } catch (error) {
    console.error('Erro ao buscar detalhes do terapeuta:', error);
    res.status(500).json({ error: 'Erro ao buscar detalhes do terapeuta' });
  }
});

/**
 * @route GET /therapists/:therapistId/availability
 * @desc Obter disponibilidade de um terapeuta
 * @access Privado (terapeuta e clientes)
 */
router.get('/:therapistId/availability', authenticate, async (req, res) => {
  try {
    const { therapistId } = req.params;
    const { month, year } = req.query;
    
    console.log('Buscando disponibilidade para terapeuta:', therapistId, 'Mês:', month, 'Ano:', year);
    
    // Verificar se o terapeuta existe
    const therapist = await prisma.therapist.findUnique({
      where: { id: therapistId }
    });
    
    if (!therapist) {
      return res.status(404).json({ message: 'Terapeuta não encontrado' });
    }
    
    // Verificar permissões - terapeuta dono ou qualquer cliente pode ver
    const isOwner = therapist.userId === req.user.id;
    const isClient = req.user.role === 'CLIENT';
    
    if (!isOwner && !isClient) {
      return res.status(403).json({ message: 'Você não tem permissão para acessar estes dados' });
    }
    
    // Buscar disponibilidade
    const availability = await prisma.availability.findMany({
      where: { therapistId },
      orderBy: [
        { dayOfWeek: 'asc' },
        { startTime: 'asc' }
      ]
    });
    
    console.log('Disponibilidades encontradas:', availability);
    
    return res.json(availability);
  } catch (error) {
    console.error('Erro ao buscar disponibilidade:', error);
    return res.status(500).json({ message: 'Erro ao buscar disponibilidade do terapeuta' });
  }
});

/**
 * @route POST /therapists/:therapistId/availability
 * @desc Salvar disponibilidade de um terapeuta
 * @access Privado (apenas o próprio terapeuta)
 */
router.post('/:therapistId/availability', authenticate, authorize(['THERAPIST']), async (req, res) => {
  try {
    const { therapistId } = req.params;
    const { availability } = req.body;
    
    console.log('Recebendo requisição de disponibilidade:', {
      therapistId,
      quantidadeDeItems: availability?.length || 0
    });
    
    // Detalhes para debug
    if (Array.isArray(availability)) {
      console.log('Detalhamento dos itens recebidos:');
      const recorrentes = availability.filter(item => item.isRecurring);
      const especificos = availability.filter(item => !item.isRecurring);
      
      console.log(`- Total de itens: ${availability.length}`);
      console.log(`- Itens recorrentes: ${recorrentes.length}`);
      console.log(`- Itens para datas específicas: ${especificos.length}`);
      
      // Log de validação - verificar dados críticos
      const itemsInvalidos = availability.filter(item => {
        if (item.isRecurring && (item.dayOfWeek === undefined || !item.startTime || !item.endTime)) {
          return true;
        }
        if (!item.isRecurring && (!item.date || !item.startTime || !item.endTime)) {
          return true;
        }
        return false;
      });
      
      if (itemsInvalidos.length > 0) {
        console.error('Itens com dados inválidos:', itemsInvalidos);
      }
    } else {
      return res.status(400).json({ 
        message: 'O formato da disponibilidade é inválido', 
        error: 'O campo availability deve ser um array' 
      });
    }
    
    // Verificar se o terapeuta existe
    const therapist = await prisma.therapist.findUnique({
      where: { id: therapistId }
    });
    
    if (!therapist) {
      return res.status(404).json({ message: 'Terapeuta não encontrado' });
    }
    
    // Verificar se o usuário logado é o dono do perfil
    if (therapist.userId !== req.user.id) {
      return res.status(403).json({ message: 'Você não tem permissão para modificar estes dados' });
    }
    
    // Primeiro, excluir todas as disponibilidades existentes do terapeuta
    console.log(`Excluindo disponibilidades existentes para o terapeuta ${therapistId}`);
    await prisma.availability.deleteMany({
      where: { therapistId }
    });
    
    // Validar e processar cada item da disponibilidade
    const processedData = availability.map(slot => {
      // Dados básicos para todos os tipos
      const data = {
        therapistId,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isRecurring: slot.isRecurring === true,
      };
      
      // Adicionar campos específicos com base no tipo
      if (slot.isRecurring) {
        // Para eventos recorrentes
        data.dayOfWeek = parseInt(slot.dayOfWeek);
      } else {
        // Para eventos específicos
        data.date = slot.date; // YYYY-MM-DD
        data.dayOfWeek = new Date(slot.date).getDay(); // Dia da semana (0-6)
      }
      
      return data;
    });
    
    console.log('Dados processados para inserção:', processedData.length);
    
    // Criar novas disponibilidades em uma transação
    const createdItems = await prisma.$transaction(
      processedData.map(data => 
        prisma.availability.create({
          data
        })
      )
    );
    
    console.log(`${createdItems.length} slots de disponibilidade criados com sucesso`);
    
    // Retornar resultado
    return res.json({
      success: true,
      message: 'Disponibilidade atualizada com sucesso',
      count: createdItems.length
    });
    
  } catch (error) {
    console.error('Erro ao atualizar disponibilidade:', error);
    return res.status(500).json({ 
      message: 'Erro ao atualizar disponibilidade do terapeuta',
      error: error.message
    });
  }
});

/**
 * @route PUT /therapists/:id
 * @desc Atualizar perfil de um terapeuta
 * @access Privado (apenas o próprio terapeuta)
 */
router.put('/:id', authenticate, authorize(['THERAPIST']), updateTherapistProfile);

/**
 * @route POST /therapists/:id/upload-picture
 * @desc Upload de imagem de perfil de um terapeuta
 * @access Privado (apenas o próprio terapeuta)
 */
router.post('/:id/upload-picture', authenticate, authorize(['THERAPIST']), upload.single('profilePicture'), uploadProfilePicture);

/**
 * @route GET /therapists/admin/all
 * @desc Obter lista de todos os terapeutas (aprovados ou não)
 * @access Privado (apenas administradores)
 */
router.get('/admin/all', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const therapists = await prisma.therapist.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const mappedTherapists = therapists.map(therapist => ({
      id: therapist.id,
      userId: therapist.userId,
      name: therapist.user.name,
      email: therapist.user.email,
      shortBio: therapist.shortBio,
      isApproved: therapist.isApproved,
      profilePicture: therapist.profilePicture,
      baseSessionPrice: therapist.baseSessionPrice,
      createdAt: therapist.createdAt
    }));

    res.json(mappedTherapists);
  } catch (error) {
    console.error('Erro ao buscar todos os terapeutas:', error);
    res.status(500).json({ message: 'Erro ao buscar terapeutas' });
  }
});

/**
 * @route PUT /therapists/admin/approve/:id
 * @desc Aprovar um terapeuta
 * @access Privado (apenas administradores)
 */
router.put('/admin/approve/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const therapist = await prisma.therapist.update({
      where: { id },
      data: { isApproved: true }
    });
    
    res.json({ message: 'Terapeuta aprovado com sucesso', therapist });
  } catch (error) {
    console.error('Erro ao aprovar terapeuta:', error);
    res.status(500).json({ message: 'Erro ao aprovar terapeuta' });
  }
});

/**
 * @route GET /therapists/:id/timeslots
 * @desc Obter horários disponíveis de um terapeuta para uma data específica
 * @access Público
 */
router.get('/:id/timeslots', async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;

    console.log('Data recebida:', date);

    if (!date) {
      return res.status(400).json({ message: 'Data é obrigatória' });
    }

    // Converter a data para objeto Date mantendo o dia correto
    const [year, month, day] = date.split('-').map(Number);
    const searchDate = new Date(year, month - 1, day);
    
    // Verificar se é uma data válida
    if (isNaN(searchDate.getTime())) {
      return res.status(400).json({ message: 'Data inválida' });
    }

    const dayOfWeek = searchDate.getDay();

    console.log('Data processada:', {
      dataOriginal: date,
      dataConvertida: searchDate.toISOString(),
      dataLocal: searchDate.toLocaleDateString(),
      diaDaSemana: dayOfWeek
    });

    // Buscar o terapeuta e suas configurações de disponibilidade
    const therapist = await prisma.therapist.findUnique({
      where: { id },
      include: {
        availability: true,
        appointments: {
          where: {
            date: {
              gte: startOfDay(searchDate),
              lt: endOfDay(searchDate)
            },
            status: {
              not: 'CANCELLED'
            }
          }
        }
      }
    });

    if (!therapist) {
      return res.status(404).json({ message: 'Terapeuta não encontrado' });
    }

    console.log('Disponibilidades cadastradas:', JSON.stringify(therapist.availability, null, 2));

    // Gerar horários disponíveis baseado na disponibilidade do terapeuta
    const availability = therapist.availability.find(a => a.dayOfWeek === dayOfWeek);

    console.log('Disponibilidade encontrada para o dia:', availability);

    if (!availability) {
      console.log('Nenhuma disponibilidade encontrada para este dia da semana:', dayOfWeek);
      return res.json({ timeSlots: [] });
    }

    // Gerar slots de horário baseado no intervalo de disponibilidade
    // Usar a data selecionada com os horários da disponibilidade
    const [startHour, startMinute] = availability.startTime.split(':').map(Number);
    const [endHour, endMinute] = availability.endTime.split(':').map(Number);
    
    const startTime = new Date(year, month - 1, day, startHour, startMinute);
    const endTime = new Date(year, month - 1, day, endHour, endMinute);
    
    const sessionDuration = therapist.sessionDuration || 50; // duração padrão de 50 minutos

    console.log('Gerando slots entre:', {
      inicio: startTime.toLocaleString(),
      fim: endTime.toLocaleString(),
      duracaoSessao: sessionDuration
    });

    const timeSlots = [];
    let currentSlot = startTime;

    while (currentSlot < endTime) {
      const slotEnd = new Date(currentSlot.getTime() + sessionDuration * 60000);
      
      // Verificar se este horário já está agendado
      const isBooked = therapist.appointments.some(appointment => {
        const appointmentStart = new Date(appointment.date);
        const appointmentEnd = new Date(appointmentStart.getTime() + appointment.duration * 60000);
        return (
          (currentSlot >= appointmentStart && currentSlot < appointmentEnd) ||
          (slotEnd > appointmentStart && slotEnd <= appointmentEnd)
        );
      });

      if (!isBooked) {
        const timeSlot = currentSlot.toLocaleTimeString('pt-BR', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false 
        });
        timeSlots.push(timeSlot);
      }

      // Avançar para o próximo slot
      currentSlot = slotEnd;
    }

    console.log('Slots disponíveis:', timeSlots);

    res.json({ timeSlots });
  } catch (error) {
    console.error('Erro ao buscar horários disponíveis:', error);
    res.status(500).json({ message: 'Erro ao buscar horários disponíveis' });
  }
});

// Criar um novo terapeuta
router.post('/therapists', async (req, res) => {
  try {
    const {
      userId,
      shortBio,
      niches,
      education,
      experience,
      targetAudience,
      differential,
      baseSessionPrice,
      sessionDuration,
      tools, // Array de { toolId, price }
      attendanceMode,
      address,
      neighborhood,
      city,
      state,
      zipCode,
      offersFreeSession,
      freeSessionDuration
    } = req.body;

    // Validar dados obrigatórios
    if (!userId || !shortBio || !niches || !education || !experience || !baseSessionPrice || !sessionDuration || !tools || !tools.length) {
      return res.status(400).json({ error: 'Dados obrigatórios faltando' });
    }

    // Criar o terapeuta
    const therapist = await prisma.therapist.create({
      data: {
        userId,
        shortBio,
        niches,
        education,
        experience,
        targetAudience,
        differential,
        baseSessionPrice,
        sessionDuration,
        attendanceMode,
        address,
        neighborhood,
        city,
        state,
        zipCode,
        offersFreeSession,
        freeSessionDuration,
        tools: {
          create: tools.map(tool => ({
            toolId: tool.toolId,
            price: tool.price || 0
          }))
        }
      },
      include: {
        user: true,
        tools: {
          include: {
            tool: true
          }
        }
      }
    });

    res.json(therapist);
  } catch (error) {
    console.error('Erro ao criar terapeuta:', error);
    res.status(500).json({ error: 'Erro ao criar terapeuta' });
  }
});

// Obter disponibilidade do terapeuta para uma data específica
router.get('/therapists/:id/availability', async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Data é obrigatória' });
    }

    console.log('Buscando disponibilidade para:', { therapistId: id, date });

    // Buscar disponibilidade do terapeuta para o dia da semana
    const dayOfWeek = new Date(date).getDay();
    const availability = await prisma.availability.findMany({
      where: {
        therapistId: id,
        dayOfWeek
      }
    });

    if (!availability.length) {
      return res.json({ timeSlots: [] });
    }

    // Buscar agendamentos existentes para a data
    const existingAppointments = await prisma.appointment.findMany({
      where: {
        therapistId: id,
        date: {
          gte: new Date(`${date}T00:00:00`),
          lt: new Date(`${date}T23:59:59`)
        }
      },
      include: {
        tool: true
      }
    });

    // Gerar horários disponíveis baseado na disponibilidade e agendamentos existentes
    const timeSlots = [];
    for (const slot of availability) {
      let currentTime = new Date(`${date}T${slot.startTime}`);
      const endTime = new Date(`${date}T${slot.endTime}`);

      while (currentTime < endTime) {
        const timeStr = currentTime.toISOString().split('T')[1].substring(0, 5);
        const isAvailable = !existingAppointments.some(appt => {
          const appointmentStart = new Date(`${date}T${appt.time}`);
          const appointmentEnd = new Date(appointmentStart.getTime() + appt.tool.duration * 60000);
          return currentTime >= appointmentStart && currentTime < appointmentEnd;
        });

        if (isAvailable) {
          timeSlots.push(timeStr);
        }

        // Avançar 30 minutos
        currentTime = new Date(currentTime.getTime() + 30 * 60000);
      }
    }

    console.log('Horários disponíveis:', timeSlots);
    res.json({ timeSlots: timeSlots.sort() });
  } catch (error) {
    console.error('Erro ao buscar disponibilidade:', error);
    res.status(500).json({ error: 'Erro ao buscar disponibilidade' });
  }
});

/**
 * @route POST /therapists/:id/appointments
 * @desc Rota alternativa para criar agendamento através do terapeuta
 * @access Privado
 */
router.post('/:id/appointments', authenticate, async (req, res) => {
  try {
    const { id } = req.params; // ID do terapeuta
    
    // Incluir o ID do terapeuta nos dados do agendamento
    const appointmentData = { ...req.body, therapistId: id };
    
    console.log('Criando agendamento (rota alternativa) para terapeuta:', id);
    console.log('Dados do agendamento:', appointmentData);
    
    const {
      clientId,
      date,
      time,
      toolId,
      mode
    } = appointmentData;

    // Validar dados obrigatórios
    if (!clientId || !date || !time || !toolId) {
      return res.status(400).json({ error: 'Dados obrigatórios faltando' });
    }

    // Verificar se o terapeuta existe e está aprovado
    const therapist = await prisma.therapist.findUnique({
      where: { id },
      include: {
        tools: {
          where: { toolId },
          include: { tool: true }
        }
      }
    });

    if (!therapist) {
      return res.status(404).json({ error: 'Terapeuta não encontrado' });
    }

    // Verificar se o terapeuta oferece a ferramenta selecionada
    const therapistTool = therapist.tools[0];
    if (!therapistTool) {
      return res.status(400).json({ error: 'Ferramenta não disponível para este terapeuta' });
    }

    // Verificar se o clientId é na verdade o userId (compatibilidade com frontend)
    let finalClientId = clientId;
    
    // Tentar buscar o cliente pelo userId (se o clientId fornecido for o userId)
    const clientByUser = await prisma.client.findFirst({
      where: { userId: clientId }
    });
    
    if (clientByUser) {
      console.log(`Cliente encontrado com userId ${clientId}: ${clientByUser.id}`);
      finalClientId = clientByUser.id;
    } else {
      // Verificar se o cliente existe com o ID fornecido
      const clientExists = await prisma.client.findUnique({
        where: { id: clientId }
      });
      
      if (!clientExists) {
        console.error(`Cliente não encontrado para o ID: ${clientId}`);
        // Adicionar tentativa adicional de encontrar cliente pelo usuário autenticado
        if (req.user && req.user.role === 'CLIENT') {
          const authenticatedClient = await prisma.client.findFirst({
            where: { userId: req.user.id }
          });
          
          if (authenticatedClient) {
            console.log(`Cliente encontrado através do token: ${authenticatedClient.id}`);
            finalClientId = authenticatedClient.id;
          } else {
            return res.status(404).json({ error: 'Cliente não encontrado' });
          }
        } else {
          return res.status(404).json({ error: 'Cliente não encontrado' });
        }
      }
    }

    // Criar o agendamento
    const appointment = await prisma.appointment.create({
      data: {
        therapistId: id,
        clientId: finalClientId,
        date,
        time,
        toolId,
        mode,
        status: 'SCHEDULED',
        price: therapistTool.price,
        duration: therapistTool.tool.duration
      },
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
        tool: true
      }
    });

    console.log('Agendamento criado com sucesso:', appointment.id);
    res.json(appointment);
  } catch (error) {
    console.error('Erro ao criar agendamento (rota alternativa):', error);
    res.status(500).json({ error: 'Erro ao criar agendamento' });
  }
});

module.exports = router;