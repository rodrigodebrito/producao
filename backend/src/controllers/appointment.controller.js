const prisma = require('../lib/prisma');
const { addHours, parseISO } = require('date-fns');

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
      
      if (fullDate) {
        // Usar a data corrigida que já inclui ajustes de fuso horário
        console.log('Usando data com ajuste de fuso horário (fullDate):', fullDate);
        appointmentDate = new Date(fullDate);
        
        // Verificar se a string isoDate inclui informações corretas de dia
        if (date) {
          // Extrair o dia esperado do formato YYYY-MM-DD
          const expectedDay = parseInt(date.split('-')[2], 10);
          const actualDay = appointmentDate.getUTCDate();
          
          if (expectedDay !== actualDay) {
            console.warn(`⚠️ Correção de timezone necessária: esperado dia ${expectedDay}, recebido ${actualDay}`);
            // Corrigir a data para manter o dia esperado
            const isoString = appointmentDate.toISOString();
            const [datePart, timePart] = isoString.split('T');
            const [year, month, _] = datePart.split('-');
            const correctedISO = `${year}-${month}-${expectedDay.toString().padStart(2, '0')}T${timePart}`;
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
      } else {
        // Apenas date sem time
        console.log('Usando apenas date sem time:', date);
        appointmentDate = parseISO(date);
      }
      
      console.log('Data de agendamento calculada:', appointmentDate.toISOString());
      console.log('Dia do agendamento (UTC):', appointmentDate.getUTCDate());
      
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
          date: appointmentDate,
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
          date: appointmentDate,
          duration: therapist.sessionDuration,
          price: therapist.baseSessionPrice,
          status: 'PENDING',
          timezone: timezone || null,
          timezoneOffset: timezoneOffset || null
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

      res.json(appointment);
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
      res.json(appointments);
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
      res.json(appointments);
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