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

      // Determinar a data do agendamento, dando preferência para fullDate quando disponível
      // Isso garante que o dia escolhido pelo usuário seja respeitado, independente do fuso horário
      let appointmentDate;
      let originalDay = null;
      
      if (date) {
        // Extrair o dia esperado do formato YYYY-MM-DD, vai servir como referência
        const dateParts = date.split('-');
        if (dateParts.length === 3) {
          originalDay = parseInt(dateParts[2], 10);
          console.log(`🕒 Dia original selecionado pelo usuário: ${originalDay}`);
        }
      }
      
      if (fullDate) {
        // Usar a data corrigida que já inclui ajustes de fuso horário
        console.log('Usando data com ajuste de fuso horário (fullDate):', fullDate);
        appointmentDate = new Date(fullDate);
        
        // Verificar se a string isoDate inclui informações corretas de dia
        if (originalDay !== null) {
          const actualDay = appointmentDate.getUTCDate();
          
          if (originalDay !== actualDay) {
            console.warn(`⚠️ Correção de timezone necessária: esperado dia ${originalDay}, recebido ${actualDay}`);
            // Corrigir a data para manter o dia esperado
            const isoString = appointmentDate.toISOString();
            const [datePart, timePart] = isoString.split('T');
            const [year, month, _] = datePart.split('-');
            const correctedISO = `${year}-${month}-${originalDay.toString().padStart(2, '0')}T${timePart}`;
            appointmentDate = new Date(correctedISO);
            
            console.log(`🛠️ Data corrigida: ${appointmentDate.toISOString()}`);
          }
        }
      } else if (date && time) {
        // Método legado: criar data a partir de strings separadas
        console.log('Usando método legado (date + time):', date, time);
        // Converter para objeto Date
        const dateObj = parseISO(date);
        const [hours, minutes] = time.split(':').map(Number);
        
        // Construir o objeto Date com as horas e minutos
        dateObj.setHours(hours, minutes, 0, 0);
        appointmentDate = dateObj;
        
        // Verificar se o dia foi preservado
        if (originalDay !== null && appointmentDate.getUTCDate() !== originalDay) {
          console.warn(`⚠️ Correção de timezone necessária: esperado dia ${originalDay}, calculado ${appointmentDate.getUTCDate()}`);
          
          // Forçar o dia original
          const correctedDate = new Date(appointmentDate);
          correctedDate.setUTCDate(originalDay);
          appointmentDate = correctedDate;
          
          console.log(`🛠️ Data corrigida: ${appointmentDate.toISOString()}`);
        }
      } else {
        // Apenas date sem time
        console.log('Usando apenas date sem time:', date);
        appointmentDate = parseISO(date);
        
        // Verificar se o dia foi preservado
        if (originalDay !== null && appointmentDate.getUTCDate() !== originalDay) {
          console.warn(`⚠️ Correção de timezone necessária para date sem time: esperado dia ${originalDay}, calculado ${appointmentDate.getUTCDate()}`);
          
          // Forçar o dia original
          const correctedDate = new Date(appointmentDate);
          correctedDate.setUTCDate(originalDay);
          appointmentDate = correctedDate;
          
          console.log(`🛠️ Data corrigida: ${appointmentDate.toISOString()}`);
        }
      }
      
      console.log('Data de agendamento calculada:', appointmentDate.toISOString());
      console.log('Dia do agendamento (UTC):', appointmentDate.getUTCDate());
      console.log('Dia do agendamento (Local):', appointmentDate.getDate());
      console.log('Data formatada para exibição:', format(appointmentDate, 'dd/MM/yyyy HH:mm'));
      
      // Guardar a data original em formato ISO para referenciar o dia correto
      const originalISO = appointmentDate.toISOString();
      
      // Extrair informações para o formato esperado pelo prisma
      const formattedDate = format(appointmentDate, 'yyyy-MM-dd');
      const formattedTime = format(appointmentDate, 'HH:mm');
      
      // Adicionar informações de timezone em notas
      let notes = req.body.notes || '';
      if (timezone || timezoneOffset || originalDay) {
        const tzInfo = {
          timezone,
          timezoneOffset,
          originalDay,
          originalDate: date
        };
        notes += `\n\nTZ_INFO:${JSON.stringify(tzInfo)}`;
      }
      
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

      // Criar o agendamento
      const appointment = await prisma.appointment.create({
        data: {
          therapistId,
          clientId,
          date: formattedDate,
          time: formattedTime,
          duration: therapist.sessionDuration,
          price: therapist.baseSessionPrice,
          status: 'PENDING',
          notes: notes,
          toolId: req.body.toolId || 'consultation',
          mode: req.body.mode || 'ONLINE'
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
        fullDate: originalISO
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