const prisma = require('../lib/prisma');
const { addHours, parseISO, format } = require('date-fns');

const appointmentController = {
  async create(req, res) {
    try {
      const { therapistId, date, fullDate, time, timezone, timezoneOffset } = req.body;
      const clientId = req.user.id;

      console.log('Recebendo dados de agendamento:', { 
        date, fullDate, time, therapistId, clientId, timezone, timezoneOffset 
      });

      // Verificar se o terapeuta existe
      const therapist = await prisma.therapist.findUnique({
        where: { id: therapistId }
      });

      if (!therapist) {
        return res.status(404).json({ error: 'Terapeuta não encontrado' });
      }

      // Verificar se o terapeuta tem preço e duração configurados
      if (!therapist.baseSessionPrice || !therapist.sessionDuration) {
        return res.status(400).json({ 
          error: 'O terapeuta ainda não configurou o preço e duração das sessões' 
        });
      }

      // EXTRAÇÃO DIRETA DO DIA SELECIONADO - Sempre confiável
      let selectedDay = null;
      if (date) {
        // Extrai o dia da string YYYY-MM-DD
        const dateParts = date.split('-');
        if (dateParts.length === 3) {
          selectedDay = parseInt(dateParts[2], 10);
          console.log(`📆 Dia selecionado pelo usuário: ${selectedDay}`);
        }
      }
      
      // NOVA ABORDAGEM: Sempre ancorar na data e hora informadas pelo usuário
      // Se temos date e time, temos toda a informação necessária
      let baseYear, baseMonth, appointmentDate;
      
      if (date && time) {
        // Extrair ano e mês do date
        const [yearStr, monthStr, dayStr] = date.split('-');
        baseYear = parseInt(yearStr, 10);
        baseMonth = parseInt(monthStr, 10);
        const day = parseInt(dayStr, 10);
        
        // Extrair hora e minuto do time
        const [hourStr, minuteStr] = time.split(':');
        const hour = parseInt(hourStr, 10);
        const minute = parseInt(minuteStr, 10);
        
        console.log(`🕒 Criando data de agendamento: ${baseYear}-${baseMonth}-${day} ${hour}:${minute}`);
        
        // Construir a data em formato ISO, forçando o dia selecionado
        const isoDateString = `${baseYear}-${baseMonth.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T${hourStr}:${minuteStr}:00.000Z`;
        appointmentDate = new Date(isoDateString);
        
        // VERIFICAÇÃO CRÍTICA: se o dia foi alterado pela conversão de timezone, corrigimos
        if (appointmentDate.getUTCDate() !== day) {
          console.warn(`⚠️ CORREÇÃO CRUCIAL: O dia foi alterado de ${day} para ${appointmentDate.getUTCDate()} na conversão`);
          
          // Correção forçada: manter o dia informado pelo usuário
          const [_, timePart] = appointmentDate.toISOString().split('T');
          const correctedIsoString = `${baseYear}-${baseMonth.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T${timePart}`;
          
          console.log(`🛠️ Data ISO corrigida: ${correctedIsoString}`);
          appointmentDate = new Date(correctedIsoString);
        }
      } else if (fullDate) {
        // Usar fullDate como base, mas ainda verificar o dia
        console.log(`📅 Usando fullDate fornecido: ${fullDate}`);
        appointmentDate = new Date(fullDate);
        
        // Se temos o dia selecionado, verificar se foi preservado
        if (selectedDay !== null && appointmentDate.getUTCDate() !== selectedDay) {
          console.warn(`⚠️ CORREÇÃO: Dia em fullDate (${appointmentDate.getUTCDate()}) não corresponde ao dia selecionado (${selectedDay})`);
          
          // Extrair ano e mês da data atual
          const year = appointmentDate.getUTCFullYear();
          const month = appointmentDate.getUTCMonth() + 1;
          
          // Corrigir usando o dia selecionado
          const [_, timePart] = appointmentDate.toISOString().split('T');
          const correctedIsoString = `${year}-${month.toString().padStart(2, '0')}-${selectedDay.toString().padStart(2, '0')}T${timePart}`;
          
          console.log(`🛠️ Data ISO corrigida: ${correctedIsoString}`);
          appointmentDate = new Date(correctedIsoString);
        }
      } else {
        // Fallback para data atual (não deveria acontecer)
        console.error('⚠️ ALERTA CRÍTICO: Nem date+time nem fullDate fornecidos');
        appointmentDate = new Date();
      }
      
      console.log(`✅ Data final do agendamento: ${appointmentDate.toISOString()}`);
      console.log(`✅ Dia UTC do agendamento: ${appointmentDate.getUTCDate()}`);
      console.log(`✅ Dia local do agendamento: ${appointmentDate.getDate()}`);
      
      // Extrair informações para o formato esperado pelo prisma
      const formattedDate = format(appointmentDate, 'yyyy-MM-dd');
      const formattedTime = format(appointmentDate, 'HH:mm');
      
      // Armazenar informações originais para referência e diagnóstico
      let notes = req.body.notes || '';
      const tzInfo = {
        timezone,
        timezoneOffset,
        originalDay: selectedDay,
        originalDate: date,
        originalTime: time,
        calculatedDate: formattedDate
      };
      notes += `\n\nTZ_INFO:${JSON.stringify(tzInfo)}`;
      
      // Verificar disponibilidade
      const dayOfWeek = appointmentDate.getDay();
      const timeStr = appointmentDate.toLocaleTimeString('pt-BR', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      });

      const availability = await prisma.availability.findFirst({
        where: {
          therapistId,
          dayOfWeek,
          startTime: { lte: timeStr },
          endTime: { gte: timeStr },
          isRecurring: true
        }
      });

      if (!availability) {
        return res.status(400).json({ 
          error: 'O terapeuta não tem disponibilidade neste horário' 
        });
      }

      // Verificar se já existe agendamento neste horário
      const existingAppointment = await prisma.appointment.findFirst({
        where: {
          therapistId,
          date: formattedDate,
          time: formattedTime,
          NOT: { status: 'CANCELLED' }
        }
      });

      if (existingAppointment) {
        return res.status(400).json({ 
          error: 'Já existe uma sessão agendada neste horário' 
        });
      }

      // Criar o agendamento com data original e dia preservado
      const appointment = await prisma.appointment.create({
        data: {
          therapistId,
          clientId,
          date: formattedDate,
          time: formattedTime,
          duration: therapist.sessionDuration,
          price: therapist.baseSessionPrice,
          status: 'SCHEDULED', // Alterado de PENDING para SCHEDULED para consistência
          notes: notes,
          toolId: req.body.toolId || 'consultation',
          mode: req.body.mode || 'ONLINE',
          timezone: timezone || null,
          timezoneOffset: timezoneOffset || null,
          originalDay: selectedDay,
          originalDate: date
        },
        include: {
          therapist: {
            include: {
              user: true
            }
          },
          client: true
        }
      });
      
      // Adicionar informações formatadas na resposta
      const responseAppointment = {
        ...appointment,
        formattedDate: format(appointmentDate, 'dd/MM/yyyy'),
        formattedTime: format(appointmentDate, 'HH:mm'),
        fullDate: appointmentDate.toISOString(),
        // Adicionar metadados úteis para debug
        _debug: {
          originalDay: selectedDay,
          calculatedDay: appointmentDate.getUTCDate(),
          preservedDay: selectedDay === appointmentDate.getUTCDate(),
        }
      };

      res.json(responseAppointment);
    } catch (error) {
      console.error('Erro ao criar agendamento:', error);
      res.status(500).json({ error: 'Erro ao criar agendamento' });
    }
  },

  async getByTherapist(req, res) {
    try {
      const { therapistId } = req.params;
      const appointments = await prisma.appointment.findMany({
        where: { therapistId },
        include: {
          client: true
        },
        orderBy: { date: 'asc' }
      });
      
      // Incluir informações formatadas para cada agendamento
      const formattedAppointments = appointments.map(appointment => {
        // Tentar extrair informações de timezone das notas
        let originalDay = null;
        let originalDate = null;
        
        if (appointment.notes && appointment.notes.includes('TZ_INFO:')) {
          try {
            const tzInfoStr = appointment.notes.match(/TZ_INFO:({.*})/) || [];
            if (tzInfoStr.length > 1) {
              const tzInfo = JSON.parse(tzInfoStr[1]);
              originalDay = tzInfo.originalDay;
              originalDate = tzInfo.originalDate;
              console.log(`Encontradas informações de timezone para agendamento ${appointment.id}:`, tzInfo);
            }
          } catch (e) {
            console.error('Erro ao extrair informações de timezone:', e);
          }
        }
        
        // Criar objeto Date a partir dos campos date e time
        let appointmentDate;
        try {
          appointmentDate = parseISO(`${appointment.date}T${appointment.time}`);
          
          // Se temos o dia original, verificar se precisamos corrigir
          if (originalDay !== null) {
            const currentDay = appointmentDate.getDate();
            if (originalDay !== currentDay) {
              console.log(`⚠️ Corrigindo data para o agendamento ${appointment.id}: de dia ${currentDay} para dia ${originalDay}`);
              const correctedDate = new Date(appointmentDate);
              correctedDate.setDate(originalDay);
              appointmentDate = correctedDate;
            }
          }
        } catch (e) {
          console.error('Erro ao converter data e hora para Date:', e);
          appointmentDate = new Date();
        }
        
        // Formatar data corrigida
        return {
          ...appointment,
          formattedDate: format(appointmentDate, 'dd/MM/yyyy'),
          formattedTime: format(appointmentDate, 'HH:mm')
        };
      });
      
      res.json(formattedAppointments);
    } catch (error) {
      console.error('Erro ao buscar agendamentos:', error);
      res.status(500).json({ error: 'Erro ao buscar agendamentos' });
    }
  },

  async getByClient(req, res) {
    try {
      const clientId = req.user.id;
      const appointments = await prisma.appointment.findMany({
        where: { clientId },
        include: {
          therapist: {
            include: {
              user: true
            }
          }
        },
        orderBy: { date: 'asc' }
      });
      
      // Incluir informações formatadas para cada agendamento
      const formattedAppointments = appointments.map(appointment => {
        // Tentar extrair informações de timezone das notas
        let originalDay = null;
        let originalDate = null;
        
        if (appointment.notes && appointment.notes.includes('TZ_INFO:')) {
          try {
            const tzInfoStr = appointment.notes.match(/TZ_INFO:({.*})/) || [];
            if (tzInfoStr.length > 1) {
              const tzInfo = JSON.parse(tzInfoStr[1]);
              originalDay = tzInfo.originalDay;
              originalDate = tzInfo.originalDate;
              console.log(`Encontradas informações de timezone para agendamento ${appointment.id}:`, tzInfo);
            }
          } catch (e) {
            console.error('Erro ao extrair informações de timezone:', e);
          }
        }
        
        // Criar objeto Date a partir dos campos date e time
        let appointmentDate;
        try {
          appointmentDate = parseISO(`${appointment.date}T${appointment.time}`);
          
          // Se temos o dia original, verificar se precisamos corrigir
          if (originalDay !== null) {
            const currentDay = appointmentDate.getDate();
            if (originalDay !== currentDay) {
              console.log(`⚠️ Corrigindo data para o agendamento ${appointment.id}: de dia ${currentDay} para dia ${originalDay}`);
              const correctedDate = new Date(appointmentDate);
              correctedDate.setDate(originalDay);
              appointmentDate = correctedDate;
            }
          }
        } catch (e) {
          console.error('Erro ao converter data e hora para Date:', e);
          appointmentDate = new Date();
        }
        
        // Formatar data corrigida
        return {
          ...appointment,
          formattedDate: format(appointmentDate, 'dd/MM/yyyy'),
          formattedTime: format(appointmentDate, 'HH:mm')
        };
      });
      
      res.json(formattedAppointments);
    } catch (error) {
      console.error('Erro ao buscar agendamentos:', error);
      res.status(500).json({ error: 'Erro ao buscar agendamentos' });
    }
  },

  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const appointment = await prisma.appointment.update({
        where: { id },
        data: { status },
        include: {
          therapist: {
            include: {
              user: true
            }
          },
          client: true
        }
      });

      res.json(appointment);
    } catch (error) {
      console.error('Erro ao atualizar status do agendamento:', error);
      res.status(500).json({ error: 'Erro ao atualizar status do agendamento' });
    }
  }
};

module.exports = appointmentController; 