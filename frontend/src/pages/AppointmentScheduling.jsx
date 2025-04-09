import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  getTherapistDetails, 
  createAppointment,
  createAppointmentAlternative,
  createAppointmentDirect,
  getAvailableTimeSlots, 
  getTherapistAvailability, 
  getClientByUserId 
} from '../services/appointmentService';
import { createRobustSession } from '../services/sessionService';
import './AppointmentScheduling.css';
import { format, parseISO, addDays, addWeeks, addMonths, subWeeks, startOfWeek, endOfWeek, isWithinInterval, isBefore, isAfter, isSameDay, formatISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'react-toastify';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faArrowRight, faCalendarAlt, faCircleCheck, faClock, faInfoCircle, faMapMarkerAlt, faSpinner, faExclamationTriangle, faTimes } from '@fortawesome/free-solid-svg-icons';
import api from '../services/api';

// Função auxiliar para validar se uma data é futura
const isValidFutureDate = (date, time) => {
  const now = new Date();
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  const appointmentDate = new Date(year, month - 1, day, hours, minutes);
  
  // Retorna true se a data/hora é futura
  return appointmentDate > now;
};

const formatDateToIso = (date) => {
  if (!date) return '';
  
  // Se a data já estiver em formato ISO (yyyy-MM-dd), retorna como está
  if (date.match(/^\d{4}-\d{2}-\d{2}$/)) return date;
  
  // Se estiver no formato brasileiro (dd/MM/yyyy), converte para ISO
  if (date.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
    const [day, month, year] = date.split('/').map(Number);
    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  }
  
  // Se for um objeto Date, formata para ISO
  if (date instanceof Date) {
    return format(date, 'yyyy-MM-dd');
  }
  
  return '';
};

const AppointmentScheduling = () => {
  const { id: therapistId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [therapist, setTherapist] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [selectedTool, setSelectedTool] = useState('');
  const [availableTimeSlots, setAvailableTimeSlots] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('ONLINE');
  const [summary, setSummary] = useState(null);
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [viewMode, setViewMode] = useState('week'); // 'week', 'month'
  const [availabilityData, setAvailabilityData] = useState([]);
  const [monthAvailability, setMonthAvailability] = useState({});

  // Referência para scroll
  const timeSlotRef = useRef(null);

  // Obter os dados da seleção prévia (se disponíveis)
  const locationState = location.state || {};
  const preSelectedDate = locationState.selectedDate || '';
  const preSelectedTime = locationState.selectedTime || '';
  const isFreeSession = locationState.isFreeSession || false;
  
  // Gerar data mínima (hoje) e máxima (3 meses à frente)
  const today = new Date();
  const maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + 3);

  const minDateStr = today.toISOString().split('T')[0];
  const maxDateStr = maxDate.toISOString().split('T')[0];

  // Formatação para exibição
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    
    try {
      // Tentar converter para objeto Date
      const date = typeof dateStr === 'string' ? parseISO(formatDateToIso(dateStr)) : dateStr;
      return format(date, 'dd/MM/yyyy', { locale: ptBR });
    } catch (err) {
      console.error('Erro ao formatar data:', err);
      return dateStr;
    }
  };

  // Buscar dados do terapeuta e inicializar a data/hora
  useEffect(() => {
    const fetchTherapist = async () => {
      try {
        setLoading(true);
        console.log('Buscando terapeuta com ID:', therapistId);
        
        // Se temos os dados do terapeuta no state da navegação
        let therapistData;
        if (locationState.therapist) {
          console.log('Usando dados do terapeuta do state:', locationState.therapist);
          therapistData = locationState.therapist;
          setTherapist(therapistData);
          
          // Se temos apenas uma ferramenta, seleciona automaticamente
          if (therapistData.tools && therapistData.tools.length === 1) {
            setSelectedTool(therapistData.tools[0].id);
          }
          
          // Definir modo padrão baseado nas opções disponíveis
          if (therapistData.availableModes && therapistData.availableModes.length === 1) {
            setMode(therapistData.availableModes[0]);
          }
        } else {
          // Caso contrário, busca do servidor
          const response = await getTherapistDetails(therapistId);
          console.log('Dados do terapeuta recebidos:', response);
          therapistData = response;
          setTherapist(therapistData);
          
          // Se houver apenas uma ferramenta, seleciona automaticamente
          if (therapistData.tools && therapistData.tools.length === 1) {
            setSelectedTool(therapistData.tools[0].id);
          }
          
          // Definir modo padrão baseado nas opções disponíveis
          if (therapistData.availableModes && therapistData.availableModes.length === 1) {
            setMode(therapistData.availableModes[0]);
          }
        }
        
        // Processar seleções prévias (se houver)
        if (preSelectedDate) {
          // Converter para formato ISO
          const formattedDate = formatDateToIso(preSelectedDate);
          console.log('Data pré-selecionada:', preSelectedDate, 'formatada para ISO:', formattedDate);
          
          // Definir a data selecionada
          setSelectedDate(formattedDate);
          
          // Ajustar a semana atual para incluir a data selecionada
          const date = parseISO(formattedDate);
          setCurrentWeekStart(startOfWeek(date, { weekStartsOn: 1 }));
          
          // Iniciar busca de horários disponíveis para esta data
          try {
            console.log('Buscando horários para data pré-selecionada:', formattedDate);
            const slots = await getAvailableTimeSlots(therapistId, formattedDate);
            console.log('Slots recebidos para data pré-selecionada:', slots);
            
            // Armazenar no estado
            setAvailableTimeSlots(prev => ({
              ...prev,
              [formattedDate]: slots
            }));
            
            // Atualizar disponibilidade do mês
            const [year, month, day] = formattedDate.split('-').map(Number);
            const monthKey = `${year}-${month.toString().padStart(2, '0')}`;
            
            // Agendar busca da disponibilidade do mês
            setTimeout(() => {
              getTherapistAvailability(therapistId, month, year)
                .then(response => {
                  console.log('Disponibilidade do mês recebida:', response);
                  
                  // Transformar em mapa indexado por data
                  const availabilityMap = {};
                  if (Array.isArray(response)) {
                    response.forEach(slot => {
                      if (!slot.date || !slot.startTime) return;
                      
                      if (!availabilityMap[slot.date]) {
                        availabilityMap[slot.date] = [];
                      }
                      availabilityMap[slot.date].push(slot.startTime);
                    });
                  }
                  
                  console.log('Mapa de disponibilidade atualizado:', availabilityMap);
                  setMonthAvailability(availabilityMap);
                });
            }, 200);
          } catch (slotError) {
            console.error('Erro ao buscar slots iniciais:', slotError);
          }
        }
        
        if (preSelectedTime) {
          console.log('Horário pré-selecionado:', preSelectedTime);
          setSelectedTime(preSelectedTime);
        }
        
      } catch (error) {
        console.error('Erro ao buscar dados do terapeuta:', error);
        setError('Erro ao carregar dados do terapeuta. Por favor, tente novamente.');
      } finally {
        setLoading(false);
      }
    };

    fetchTherapist();
  }, [therapistId, locationState, preSelectedDate, preSelectedTime]);

  // Buscar disponibilidade geral para o período visível
  useEffect(() => {
    const fetchMonthAvailability = async () => {
      if (!therapistId) return;
      
      try {
        setLoadingSlots(true);
        
        // Determinar o mês atual para buscar
        const currentMonth = currentWeekStart.getMonth() + 1; // Mês é base 0 em JS
        const currentYear = currentWeekStart.getFullYear();
        
        console.log(`Buscando disponibilidade para o mês ${currentMonth}/${currentYear} do terapeuta ${therapistId}`);
        
        // Buscar disponibilidade do mês
        const response = await getTherapistAvailability(therapistId, currentMonth, currentYear);
        console.log('Disponibilidade recebida do backend:', response);
        
        if (!response || !Array.isArray(response)) {
          console.error('Resposta inválida da API de disponibilidade:', response);
          return;
        }
        
        // Transformar em um objeto indexado por data para acesso mais fácil
        const availabilityMap = {};
        
        response.forEach(slot => {
          if (!slot.date || !slot.startTime) {
            console.warn('Slot sem data ou horário:', slot);
            return;
          }
          
          const { date, startTime } = slot;
          if (!availabilityMap[date]) {
            availabilityMap[date] = [];
          }
          availabilityMap[date].push(startTime);
        });
        
        console.log('Mapa de disponibilidade por data:', availabilityMap);
        setMonthAvailability(availabilityMap);
        setAvailabilityData(response);
        
        // Se temos uma data selecionada, atualizar os slots disponíveis
        if (selectedDate) {
          const formattedDate = formatDateToIso(selectedDate);
          const dateSlots = availabilityMap[formattedDate] || [];
          console.log(`Atualizando slots para ${formattedDate}:`, dateSlots);
          
          setAvailableTimeSlots(prev => ({
            ...prev,
            [formattedDate]: dateSlots
          }));
        }
        
      } catch (error) {
        console.error('Erro ao buscar disponibilidade mensal:', error);
        toast.error('Não foi possível carregar a disponibilidade do terapeuta');
      } finally {
        setLoadingSlots(false);
      }
    };
    
    fetchMonthAvailability();
  }, [therapistId, currentWeekStart, selectedDate]);

  // Buscar horários disponíveis quando a data é selecionada
  useEffect(() => {
    const fetchTimeSlots = async () => {
      if (!selectedDate || !therapistId) {
        console.log('Sem data selecionada ou therapistId, não buscando slots');
        return;
      }

      try {
        console.log(`Iniciando busca de slots para a data ${selectedDate}`);
        setLoadingSlots(true);
        
        // Verificar se já temos os slots no monthAvailability
        const formattedDate = formatDateToIso(selectedDate);
        const cachedSlots = monthAvailability[formattedDate];
        
        if (cachedSlots && cachedSlots.length > 0) {
          console.log(`Usando slots do cache para ${formattedDate}:`, cachedSlots);
          
          // Usar os dados do cache
          setAvailableTimeSlots(prev => ({
            ...prev,
            [formattedDate]: cachedSlots
          }));
          
          setError('');
        } else {
          // Buscar do servidor
          console.log(`Buscando novos slots do servidor para ${formattedDate}`);
          const slots = await getAvailableTimeSlots(therapistId, formattedDate);
          console.log(`Slots recebidos do servidor:`, slots);
          
          // Armazenar os slots no estado
          setAvailableTimeSlots(prev => ({
            ...prev,
            [formattedDate]: slots
          }));
          
          // Atualizar o monthAvailability com os novos dados
          setMonthAvailability(prev => ({
            ...prev,
            [formattedDate]: slots
          }));
          
          // Se temos um horário pré-selecionado, verificar se está disponível
          if (preSelectedTime && !slots.includes(preSelectedTime)) {
            console.warn(`Horário pré-selecionado (${preSelectedTime}) não está disponível`);
            toast.warning(`O horário pré-selecionado (${preSelectedTime}) não está mais disponível.`);
            setSelectedTime('');
          }
          
          setError('');
        }
        
        // Rolar para a seção de horários
        if (timeSlotRef.current) {
          setTimeout(() => {
            timeSlotRef.current.scrollIntoView({ behavior: 'smooth' });
          }, 300);
        }
      } catch (error) {
        console.error('Erro ao buscar horários:', error);
        setError('Erro ao carregar horários disponíveis. Por favor, tente novamente.');
        setAvailableTimeSlots(prev => ({
          ...prev,
          [selectedDate]: []
        }));
      } finally {
        setLoadingSlots(false);
      }
    };

    if (selectedDate) {
      fetchTimeSlots();
    }
  }, [therapistId, selectedDate, monthAvailability, preSelectedTime]);

  // Efeito para atualizar o resumo da consulta
  useEffect(() => {
    if (therapist && selectedDate && selectedTime && selectedTool) {
      const selectedToolData = therapist.tools?.find(t => t.id === selectedTool);
      
      if (selectedToolData) {
        setSummary({
          therapist: therapist.name || `${therapist.firstName || ''} ${therapist.lastName || ''}`,
          date: formatDate(selectedDate),
          time: selectedTime,
          tool: selectedToolData.name,
          duration: selectedToolData.duration,
          price: isFreeSession ? 0 : selectedToolData.price,
          isFreeSession
        });
      }
    } else {
      setSummary(null);
    }
  }, [therapist, selectedDate, selectedTime, selectedTool, isFreeSession]);
  
  // Função para avançar/retroceder semanas
  const navigateWeek = (direction) => {
    setCurrentWeekStart(prev => {
      if (direction === 'next') {
        return addWeeks(prev, 1);
      } else {
        // Não permitir navegar para semanas no passado
        const prevWeek = subWeeks(prev, 1);
        return isBefore(prevWeek, startOfWeek(today, { weekStartsOn: 1 })) 
          ? startOfWeek(today, { weekStartsOn: 1 }) 
          : prevWeek;
      }
    });
  };
  
  // Função para gerar os dias da semana atual
  const generateWeekDays = () => {
    const days = [];
    const startDate = currentWeekStart;
    
    console.log('Gerando dias da semana a partir de:', format(startDate, 'dd/MM/yyyy'));
    
    // Verificar se a semana está além do limite de 3 meses
    const isWeekBeyondLimit = isAfter(startDate, maxDate);
    if (isWeekBeyondLimit) {
      console.log('Semana além do limite, ajustando...');
      setCurrentWeekStart(startOfWeek(maxDate, { weekStartsOn: 1 }));
      return [];
    }
    
    for (let i = 0; i < 7; i++) {
      const date = addDays(startDate, i);
      const dateStr = formatISO(date, { representation: 'date' });
      
      // Verificar se a data está dentro do intervalo permitido
      const isPast = isBefore(date, today) && !isSameDay(date, today);
      const isBeyondLimit = isAfter(date, maxDate);
      
      // Verificar se a data tem horários disponíveis
      const hasSlots = monthAvailability[dateStr] && monthAvailability[dateStr].length > 0;
      
      console.log(`Dia ${format(date, 'dd/MM/yyyy')} (${dateStr}): 
        passado=${isPast}, 
        alémdoLimite=${isBeyondLimit}, 
        hoje=${isSameDay(date, today)}, 
        selecionado=${selectedDate === dateStr}, 
        temSlots=${hasSlots}, 
        slots=${JSON.stringify(monthAvailability[dateStr] || [])}
      `);
      
      days.push({
        date,
        dateStr,
        weekday: format(date, 'EEE', { locale: ptBR }),
        day: format(date, 'd', { locale: ptBR }),
        isPast,
        isBeyondLimit,
        isToday: isSameDay(date, today),
        isSelected: selectedDate === dateStr,
        hasSlots
      });
    }
    
    return days;
  };
  
  // Função para alternar entre visualização de semana e mês
  const toggleViewMode = (mode) => {
    setViewMode(mode);
  };
  
  // Função para selecionar uma data
  const handleDateSelect = (dateStr) => {
    console.log('Data selecionada:', dateStr);
    
    // Atualizar a data selecionada
    setSelectedDate(dateStr);
    
    // Limpar a seleção de horário atual
    setSelectedTime('');
    
    // Verificar se já temos os slots para esta data no estado
    if (availableTimeSlots[dateStr]) {
      console.log(`Usando slots armazenados para ${dateStr}:`, availableTimeSlots[dateStr]);
    } else {
      // Se não temos, precisamos buscar os slots
      console.log(`Buscando novos slots para a data ${dateStr}`);
      
      // Tentar usar os dados já carregados no monthAvailability
      const dateSlots = monthAvailability[dateStr] || [];
      if (dateSlots.length > 0) {
        console.log(`Encontrados ${dateSlots.length} slots no mapa de disponibilidade:`, dateSlots);
        setAvailableTimeSlots(prev => ({
          ...prev,
          [dateStr]: dateSlots
        }));
      } else {
        // Fazer uma nova requisição se necessário, já tratada pelo useEffect
        console.log('Sem slots no mapa, será acionado o useEffect para buscar os slots');
      }
    }
  };

  const handleTimeSelect = (time) => {
    setSelectedTime(time);
  };

  const handleToolChange = (e) => {
    setSelectedTool(e.target.value);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!selectedDate || !selectedTime || !selectedTool) {
      setError('Por favor, selecione data, horário e ferramenta');
      return;
    }

    // Verificar se o usuário está autenticado
    if (!user) {
      setError('Usuário não autenticado. Por favor, faça login novamente.');
      navigate('/login');
      return;
    }

    try {
      setLoading(true);
      const selectedToolData = therapist.tools.find(t => t.id === selectedTool);
      
      // Criar dados do agendamento (sem clientId forçado)
      const appointmentData = {
        therapistId,
        date: selectedDate,
        time: selectedTime,
        toolId: selectedTool,
        duration: selectedToolData.duration,
        price: isFreeSession ? 0 : selectedToolData.price,
        mode,
        isFreeSession,
        therapistName: therapist.name
      };

      // Criar o agendamento
      const appointmentResult = await createAppointment(appointmentData);
      
      // Criar a sessão
      if (appointmentResult && appointmentResult.id) {
        try {
          const sessionData = await createRobustSession({
            ...appointmentData,
            id: appointmentResult.id
          });
          
          // Navegar para a página de sucesso
          toast.success('Agendamento e sala de sessão criados com sucesso!');
          navigate('/appointment-success', { 
            state: { 
              appointmentData: {
                ...appointmentData,
                id: appointmentResult.id
              },
              sessionData 
            } 
          });
        } catch (sessionError) {
          // Se falhar a criação da sessão, apenas navegar para a lista de agendamentos
          toast.success('Agendamento criado com sucesso!');
          toast.error('Não foi possível criar a sala de sessão. Você poderá entrar mais tarde.');
          
          // Redirecionar para a lista de agendamentos conforme o papel do usuário
          if (user.role === 'CLIENT') {
            navigate('/client/appointments');
          } else if (user.role === 'THERAPIST') {
            navigate('/therapist/appointments');
          } else {
            navigate('/dashboard');
          }
        }
      } else {
        // Se tudo falhar, navegue para a lista de agendamentos com base no papel
        toast.success('Agendamento registrado!');
        if (user.role === 'CLIENT') {
          navigate('/client/appointments');
        } else if (user.role === 'THERAPIST') {
          navigate('/therapist/appointments');
        } else {
          navigate('/dashboard');
        }
      }
    } catch (error) {
      if (error.response && error.response.data && error.response.data.error) {
        setError(`Erro: ${error.response.data.error}`);
      } else {
        setError('Erro ao criar agendamento. Por favor, tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Melhorar a renderização dos slots de horário
  const renderAvailableTimeSlots = () => {
    if (!selectedDate) {
      console.log('Nenhuma data selecionada para renderizar slots');
      return (
        <div className="time-slots-container">
          <div className="no-slots-message">
            <FontAwesomeIcon icon={faInfoCircle} />
            <p>Selecione uma data para ver os horários disponíveis.</p>
          </div>
        </div>
      );
    }
    
    // Garantir que estamos usando o formato correto da data para acessar os slots
    const formattedDate = formatDateToIso(selectedDate);
    const slots = availableTimeSlots[formattedDate] || [];
    
    console.log(`Renderizando slots para ${selectedDate} (${formattedDate}):`, slots);
    console.log('Estado atual de availableTimeSlots:', availableTimeSlots);
    
    if (loadingSlots) {
      return (
        <div className="time-slots-container" ref={timeSlotRef}>
          <div className="loading-slots">
            <FontAwesomeIcon icon={faSpinner} spin />
            <span>Carregando horários disponíveis...</span>
          </div>
        </div>
      );
    }
    
    if (!slots || slots.length === 0) {
      return (
        <div className="time-slots-container" ref={timeSlotRef}>
          <div className="no-slots-message">
            <FontAwesomeIcon icon={faInfoCircle} />
            <p>Não há horários disponíveis para esta data.</p>
            <button 
              type="button"
              className="time-button"
              onClick={() => {
                // Tentar buscar slots novamente
                console.log('Tentando recarregar slots para:', formattedDate);
                setLoadingSlots(true);
                getAvailableTimeSlots(therapistId, formattedDate)
                  .then(newSlots => {
                    console.log('Slots recarregados:', newSlots);
                    setAvailableTimeSlots(prev => ({
                      ...prev,
                      [formattedDate]: newSlots
                    }));
                    if (newSlots.length === 0) {
                      toast.info('Não há horários disponíveis para esta data.');
                    }
                  })
                  .catch(err => {
                    console.error('Erro ao recarregar slots:', err);
                    toast.error('Erro ao carregar horários. Tente novamente.');
                  })
                  .finally(() => setLoadingSlots(false));
              }}
            >
              Tentar Novamente
            </button>
          </div>
        </div>
      );
    }
    
    // Ordenar os slots por horário
    const sortedSlots = [...slots].sort();
    
    // Agrupar horários por período: Manhã (06-12), Tarde (12-18), Noite (18-23)
    const morningSlots = sortedSlots.filter(slot => {
      const hour = parseInt(slot.split(':')[0]);
      return hour >= 6 && hour < 12;
    });
    
    const afternoonSlots = sortedSlots.filter(slot => {
      const hour = parseInt(slot.split(':')[0]);
      return hour >= 12 && hour < 18;
    });
    
    const eveningSlots = sortedSlots.filter(slot => {
      const hour = parseInt(slot.split(':')[0]);
      return hour >= 18 && hour < 23;
    });
    
    console.log('Slots agrupados:', {
      manhã: morningSlots,
      tarde: afternoonSlots,
      noite: eveningSlots
    });
    
    return (
      <div className="time-slots-container" ref={timeSlotRef}>
        {morningSlots.length > 0 && (
          <div className="time-period">
            <h4><FontAwesomeIcon icon={faClock} /> Manhã</h4>
            <div className="time-buttons">
              {morningSlots.map(time => (
                <button
                  key={time}
                  type="button"
                  className={`time-button ${selectedTime === time ? 'selected' : ''}`}
                  onClick={() => handleTimeSelect(time)}
                >
                  {time}
                </button>
              ))}
            </div>
          </div>
        )}
        
        {afternoonSlots.length > 0 && (
          <div className="time-period">
            <h4><FontAwesomeIcon icon={faClock} /> Tarde</h4>
            <div className="time-buttons">
              {afternoonSlots.map(time => (
                <button
                  key={time}
                  type="button"
                  className={`time-button ${selectedTime === time ? 'selected' : ''}`}
                  onClick={() => handleTimeSelect(time)}
                >
                  {time}
                </button>
              ))}
            </div>
          </div>
        )}
        
        {eveningSlots.length > 0 && (
          <div className="time-period">
            <h4><FontAwesomeIcon icon={faClock} /> Noite</h4>
            <div className="time-buttons">
              {eveningSlots.map(time => (
                <button
                  key={time}
                  type="button"
                  className={`time-button ${selectedTime === time ? 'selected' : ''}`}
                  onClick={() => handleTimeSelect(time)}
                >
                  {time}
                </button>
              ))}
            </div>
          </div>
        )}
        
        {morningSlots.length === 0 && afternoonSlots.length === 0 && eveningSlots.length === 0 && (
          <div className="no-slots-message">
            <FontAwesomeIcon icon={faInfoCircle} />
            <p>Formato dos horários não reconhecido. Entre em contato com o suporte.</p>
          </div>
        )}
      </div>
    );
  };

  if (loading && !therapist) {
    return (
      <div className="appointment-scheduling">
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Carregando dados do terapeuta...</p>
        </div>
      </div>
    );
  }

  if (error && !therapist) {
    return (
      <div className="appointment-scheduling">
        <div className="error-container">
          <div className="alert alert-danger">{error}</div>
          <button className="btn btn-primary" onClick={() => navigate(-1)}>Voltar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="appointment-scheduling">
      <div className="scheduling-header">
        <button className="back-button" onClick={() => navigate(-1)}>
          <FontAwesomeIcon icon={faArrowLeft} /> Voltar
        </button>
        <h2>Agendar Consulta</h2>
      </div>
      
      {error && (
        <div className="error-message">
          <FontAwesomeIcon icon={faExclamationTriangle} />
          <span>{error}</span>
          <button onClick={() => setError('')} className="close-button">
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>
      )}
      
      <div className="appointment-content">
        <div className="therapist-card">
          <div className="therapist-avatar">
            {therapist?.profilePicture ? (
              <img src={therapist.profilePicture} alt={therapist.name} />
            ) : (
              <div className="avatar-placeholder">
                {therapist?.name?.charAt(0) || 'T'}
              </div>
            )}
          </div>
          
          <div className="therapist-details">
            <h3>{therapist?.name}</h3>
            <p>{therapist?.shortBio || 'Terapeuta'}</p>
            
            <div className="therapist-tags">
              {therapist?.niches?.slice(0, 3).map((niche, index) => (
                <span key={index} className="tag">{niche}</span>
              ))}
              {therapist?.niches?.length > 3 && (
                <span className="more-tags">+{therapist.niches.length - 3}</span>
              )}
            </div>
            
            <div className="therapist-info">
              <div className="info-item">
                <FontAwesomeIcon icon={faMapMarkerAlt} />
                <span>{therapist?.city || 'Online'}</span>
              </div>
              
              <div className="info-item pricing">
                <FontAwesomeIcon icon={faClock} />
                <span>{therapist?.sessionDuration || 50} min</span>
              </div>
              
              <div className="info-item pricing">
                <span className="price-label">Preço:</span>
                <span className="price-value">
                  {isFreeSession ? (
                    <span className="free-session">Gratuito</span>
                  ) : (
                    `R$ ${therapist?.baseSessionPrice?.toFixed(2)}`
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="scheduling-form-container">
          <form onSubmit={handleSubmit}>
            <div className="form-section">
              <h3>Selecione uma ferramenta</h3>
              
              <div className="form-group">
                <select
                  value={selectedTool}
                  onChange={handleToolChange}
                  required
                  className="form-control"
                >
                  <option value="">Selecione o tipo de consulta</option>
                  {therapist?.tools?.map((tool) => (
                    <option key={tool.id} value={tool.id}>
                      {tool.name} ({tool.duration}min) - {isFreeSession ? 'Gratuito' : `R$ ${tool.price.toFixed(2)}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="form-section">
              <div className="section-header">
                <h3>Selecione um horário</h3>
              </div>
              
              <div className="view-selector" style={{ 
                display: 'flex', 
                justifyContent: 'center', 
                margin: '1rem 0',
                gap: '1rem'
              }}>
                <button 
                  type="button" 
                  className={`selector-button ${viewMode === 'week' ? 'active' : ''}`}
                  style={{ 
                    background: viewMode === 'week' ? '#3182ce' : '#e2e8f0',
                    color: viewMode === 'week' ? 'white' : '#4a5568',
                    border: 'none',
                    padding: '0.5rem 1rem',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                    fontWeight: viewMode === 'week' ? 'bold' : 'normal'
                  }}
                  onClick={() => toggleViewMode('week')}
                >
                  <FontAwesomeIcon icon={faCalendarAlt} /> Visualização Semanal
                </button>
                
                <button 
                  type="button" 
                  className={`selector-button ${viewMode === 'month' ? 'active' : ''}`}
                  style={{ 
                    background: viewMode === 'month' ? '#3182ce' : '#e2e8f0',
                    color: viewMode === 'month' ? 'white' : '#4a5568',
                    border: 'none',
                    padding: '0.5rem 1rem',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                    fontWeight: viewMode === 'month' ? 'bold' : 'normal'
                  }}
                  onClick={() => toggleViewMode('month')}
                >
                  <FontAwesomeIcon icon={faCalendarAlt} /> Visualização Mensal
                </button>
              </div>
              
              <div className="date-controls" style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                marginBottom: '1rem'
              }}>
                {/* Exibir o período atual */}
                <div className="current-period-display" style={{ 
                  textAlign: 'center', 
                  padding: '0.75rem',
                  background: '#f8fafc',
                  borderRadius: '0.5rem',
                  fontWeight: 'bold',
                  fontSize: '1.2rem',
                  border: '1px solid #e2e8f0'
                }}>
                  {viewMode === 'week' ? (
                    <>
                      <span>{format(currentWeekStart, 'dd MMM', { locale: ptBR })}</span>
                      {' - '}
                      <span>{format(addDays(currentWeekStart, 6), 'dd MMM yyyy', { locale: ptBR })}</span>
                    </>
                  ) : (
                    <span>{format(currentWeekStart, 'MMMM yyyy', { locale: ptBR })}</span>
                  )}
                </div>
                
                {/* Botões de navegação */}
                <div className="navigation-buttons" style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between',
                  gap: '1rem'
                }}>
                  <button 
                    type="button" 
                    className="nav-button" 
                    style={{ 
                      background: '#3182ce',
                      color: 'white',
                      border: 'none',
                      padding: '0.75rem 1rem',
                      borderRadius: '0.5rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      flex: 1,
                      justifyContent: 'center'
                    }}
                    onClick={() => navigateWeek('prev')}
                    disabled={isBefore(subWeeks(currentWeekStart, 1), startOfWeek(today, { weekStartsOn: 1 }))}
                  >
                    <FontAwesomeIcon icon={faArrowLeft} /> Semana Anterior
                  </button>
                  
                  <button 
                    type="button" 
                    className="nav-button"
                    style={{ 
                      background: '#3182ce',
                      color: 'white',
                      border: 'none',
                      padding: '0.75rem 1rem',
                      borderRadius: '0.5rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      flex: 1,
                      justifyContent: 'center'
                    }}
                    onClick={() => navigateWeek('next')}
                    disabled={isAfter(addWeeks(currentWeekStart, 1), maxDate)}
                  >
                    Próxima Semana <FontAwesomeIcon icon={faArrowRight} />
                  </button>
                </div>
              </div>
              
              <div className="calendar-view">
                {loadingSlots && (
                  <div className="loading-overlay">
                    <FontAwesomeIcon icon={faSpinner} spin />
                    <span>Carregando horários...</span>
                  </div>
                )}
                
                {viewMode === 'week' && (
                  <div className="week-view">
                    {generateWeekDays().map((day) => (
                      <div 
                        key={day.dateStr}
                        className={`day-column ${day.isPast ? 'past' : ''} ${day.isToday ? 'today' : ''} ${day.isSelected ? 'selected' : ''} ${day.hasSlots ? 'has-slots' : 'no-slots'} ${day.isBeyondLimit ? 'beyond-limit' : ''}`}
                        onClick={() => {
                          if (!day.isPast && !day.isBeyondLimit) {
                            console.log('Clicou no dia:', day.dateStr, 'tem slots:', day.hasSlots);
                            handleDateSelect(day.dateStr);
                            
                            if (!day.hasSlots) {
                              console.log('Dia sem slots visíveis, tentando buscar novamente');
                              const formattedDate = formatDateToIso(day.dateStr);
                              setTimeout(() => {
                                getAvailableTimeSlots(therapistId, formattedDate)
                                  .then(slots => {
                                    console.log('Slots forçados buscados para', formattedDate, ':', slots);
                                    if (slots && slots.length > 0) {
                                      setAvailableTimeSlots(prev => ({
                                        ...prev,
                                        [formattedDate]: slots
                                      }));
                                      setMonthAvailability(prev => ({
                                        ...prev,
                                        [formattedDate]: slots
                                      }));
                                    }
                                  })
                                  .catch(err => console.error('Erro ao buscar slots forçados:', err));
                              }, 100);
                            }
                          }
                        }}
                      >
                        <div className="day-header">
                          <span className="weekday">{day.weekday}</span>
                          <span className="day-number">{day.day}</span>
                        </div>
                        
                        <div className="day-content">
                          {day.isPast ? (
                            <span className="status-label past">Indisponível</span>
                          ) : day.isBeyondLimit ? (
                            <span className="status-label beyond">Fora do limite</span>
                          ) : day.hasSlots ? (
                            <span className="status-label available">Disponível</span>
                          ) : (
                            <span className="status-label unavailable">Selecione</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {viewMode === 'month' && (
                  <div className="month-view" style={{
                    padding: '1rem',
                    textAlign: 'center',
                    background: 'white',
                    borderRadius: '0.5rem',
                    border: '1px solid #e2e8f0'
                  }}>
                    <p style={{ margin: '0 0 1rem 0', color: '#4a5568' }}>
                      <FontAwesomeIcon icon={faInfoCircle} /> Use a visualização semanal para ver os horários disponíveis
                    </p>
                    
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'center',
                      marginTop: '1rem'
                    }}>
                      <button 
                        type="button" 
                        className="selector-button active"
                        style={{ 
                          background: '#3182ce',
                          color: 'white',
                          border: 'none',
                          padding: '0.5rem 1rem',
                          borderRadius: '0.5rem',
                          cursor: 'pointer',
                          fontWeight: 'bold'
                        }}
                        onClick={() => toggleViewMode('week')}
                      >
                        Alternar para visualização semanal
                      </button>
                    </div>
                  </div>
                )}
              </div>
              
              {selectedDate && renderAvailableTimeSlots()}
            </div>
            
            {summary && (
              <div className="appointment-summary">
                <h3>Resumo da consulta</h3>
                <div className="summary-details">
                  <div className="summary-item">
                    <span className="label">Terapeuta:</span>
                    <span className="value">{summary.therapist}</span>
                  </div>
                  <div className="summary-item">
                    <span className="label">Data:</span>
                    <span className="value">{summary.date}</span>
                  </div>
                  <div className="summary-item">
                    <span className="label">Horário:</span>
                    <span className="value">{summary.time}</span>
                  </div>
                  <div className="summary-item">
                    <span className="label">Ferramenta:</span>
                    <span className="value">{summary.tool}</span>
                  </div>
                  <div className="summary-item">
                    <span className="label">Duração:</span>
                    <span className="value">{summary.duration} minutos</span>
                  </div>
                  <div className="summary-item">
                    <span className="label">Preço:</span>
                    <span className="value price">
                      {summary.isFreeSession ? (
                        <span className="free-label">Gratuito</span>
                      ) : (
                        `R$ ${summary.price.toFixed(2)}`
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}
            
            <div className="form-actions">
              <button 
                type="button" 
                className="cancel-btn" 
                onClick={() => navigate(-1)}
              >
                Cancelar
              </button>
              
              <button 
                type="submit" 
                className="confirm-btn" 
                disabled={!selectedDate || !selectedTime || !selectedTool || loading}
              >
                {loading ? (
                  <>
                    <FontAwesomeIcon icon={faSpinner} spin /> Processando...
                  </>
                ) : (
                  <>
                    <FontAwesomeIcon icon={faCalendarAlt} /> Confirmar Agendamento
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AppointmentScheduling; 