import React, { useState, useEffect, useContext } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { UserContext } from '../../contexts/UserContext';
import { getAppointments, updateAppointmentStatus } from '../../services/appointmentService';
import StatusBadge from './StatusBadge';
import AppointmentCard from './AppointmentCard';
import LoadingSpinner from '../common/LoadingSpinner';
import SearchBar from '../common/SearchBar';
import FilterDropdown from '../common/FilterDropdown';
import PageTitle from '../common/PageTitle';
import EmptyState from '../common/EmptyState';
import CalendarIcon from '../icons/CalendarIcon';

const Appointments = () => {
  const location = useLocation();
  const { user } = useContext(UserContext);
  const [appointments, setAppointments] = useState([]);
  const [filteredAppointments, setFilteredAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('upcoming');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [error, setError] = useState(null);
  
  // Status para o filtro de status
  const statusOptions = [
    { value: 'all', label: 'Todos os status' },
    { value: 'scheduled', label: 'Agendado' },
    { value: 'completed', label: 'Concluído' },
    { value: 'cancelled', label: 'Cancelado' },
    { value: 'pending', label: 'Pendente' }
  ];
  
  // Opções para o filtro de tipo
  const typeOptions = [
    { value: 'all', label: 'Todos os tipos' },
    { value: 'online', label: 'Online' },
    { value: 'inPerson', label: 'Presencial' }
  ];

  // Função para buscar agendamentos
  const fetchAppointments = async () => {
    setLoading(true);
    setError(null);
    
    console.log('Iniciando busca de agendamentos em Appointments.jsx...');
    
    try {
      const data = await getAppointments();
      console.log('Dados de agendamentos recebidos:', data);
      
      if (!data || !Array.isArray(data)) {
        console.error('Dados de agendamentos inválidos:', data);
        setAppointments([]);
        setFilteredAppointments([]);
        setError('Formato de dados inválido recebido do servidor');
      } else {
        // Processar dados
        const processedData = data.map(appointment => {
          // Verificar se a data é válida e formatá-la
          let formattedDate = '';
          
          if (appointment.date) {
            try {
              console.log(`⚠️ DEBUG processamento: Data original do agendamento ${appointment.id}: ${appointment.date}`);
              
              // Verifica se é uma string de data válida
              let parsedDate;
              
              if (typeof appointment.date === 'string') {
                if (appointment.date.includes('T')) {
                  // Data em formato ISO
                  console.log(`⚠️ DEBUG processamento: Data em formato ISO - ${appointment.date}`);
                  parsedDate = parseISO(appointment.date);
                  
                  // Extrair partes da data ISO original para comparação
                  const isoMatch = appointment.date.match(/(\d{4})-(\d{2})-(\d{2})T/);
                  if (isoMatch) {
                    const originalDay = parseInt(isoMatch[3], 10);
                    const parsedDay = parsedDate.getDate();
                    console.log(`⚠️ DEBUG processamento: Dia original na ISO string: ${originalDay}, Dia após parse: ${parsedDay}`);
                    
                    if (originalDay !== parsedDay) {
                      console.warn(`⚠️ ALERTA: Dia alterado após parse de ${originalDay} para ${parsedDay}`);
                      // Forçar o dia correto originalmente enviado (correção de timezone)
                      const dateWithCorrectDay = new Date(parsedDate);
                      dateWithCorrectDay.setDate(originalDay);
                      parsedDate = dateWithCorrectDay;
                      console.log(`⚠️ DEBUG processamento: Data corrigida: ${parsedDate.toISOString()}`);
                    }
                  }
                } else {
                  console.log(`⚠️ DEBUG processamento: Data em outro formato - ${appointment.date}`);
                  parsedDate = new Date(appointment.date);
                }
              } else {
                console.log(`⚠️ DEBUG processamento: Data não é string - ${appointment.date}`);
                parsedDate = new Date(appointment.date);
              }
              
              if (isValid(parsedDate)) {
                formattedDate = format(parsedDate, 'dd/MM/yyyy', { locale: ptBR });
                // Adiciona a data formatada ao objeto
                appointment.formattedDate = formattedDate;
                console.log(`⚠️ DEBUG processamento: Data formatada final: ${formattedDate}`);
              } else {
                console.warn('Data inválida no agendamento:', appointment.id, appointment.date);
                appointment.formattedDate = 'Data inválida';
              }
            } catch (err) {
              console.error('Erro ao formatar data:', err, appointment.date);
              appointment.formattedDate = 'Erro na data';
            }
          } else {
            console.warn('Agendamento sem data:', appointment.id);
            appointment.formattedDate = 'Sem data';
          }
          
          return appointment;
        });
        
        console.log('Dados de agendamentos processados:', processedData);
        setAppointments(processedData);
        
        // Aplicar filtros iniciais
        const filtered = filterAppointments(processedData, activeTab, searchTerm, statusFilter, typeFilter);
        setFilteredAppointments(filtered);
      }
    } catch (err) {
      console.error('Erro ao buscar agendamentos:', err);
      setError(err.message || 'Erro ao buscar agendamentos');
      toast.error(err.message || 'Erro ao buscar agendamentos');
    } finally {
      setLoading(false);
    }
  };

  // Aplicar filtros aos agendamentos
  const filterAppointments = (appointmentsList, tabFilter, search, status, type) => {
    console.log('Filtrando agendamentos:', {
      total: appointmentsList.length,
      tabFilter,
      search,
      status,
      type
    });
    
    if (!appointmentsList || appointmentsList.length === 0) {
      console.log('Lista de agendamentos vazia ou nula');
      return [];
    }
    
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Normaliza para o início do dia
    
    return appointmentsList.filter(appointment => {
      console.log('Verificando agendamento:', appointment.id);
      
      // Filtrar por data (próximos/histórico)
      let dateMatch = true;
      
      try {
        if (appointment.date) {
          let appointmentDate;
          
          if (typeof appointment.date === 'string') {
            // Se já for string, tenta converter para Date
            appointmentDate = parseISO(appointment.date);
          } else if (appointment.date instanceof Date) {
            // Se já for Date
            appointmentDate = appointment.date;
          } else {
            // Outro formato
            appointmentDate = new Date(appointment.date);
          }
          
          if (isValid(appointmentDate)) {
            appointmentDate.setHours(0, 0, 0, 0); // Normaliza para o início do dia
            
            if (tabFilter === 'upcoming') {
              dateMatch = appointmentDate >= now || appointment.status === 'scheduled' || appointment.status === 'pending';
            } else if (tabFilter === 'history') {
              dateMatch = appointmentDate < now || appointment.status === 'completed' || appointment.status === 'cancelled';
            }
            
            console.log(`Data do agendamento: ${appointmentDate.toLocaleDateString()}, Data atual: ${now.toLocaleDateString()}, Match: ${dateMatch}`);
          } else {
            console.warn('Data inválida para agendamento:', appointment.id, appointment.date);
            // Se a data for inválida, consideramos relevante para não perder agendamentos
            dateMatch = true;
          }
        } else {
          console.warn('Agendamento sem data:', appointment.id);
          // Se não tiver data, consideramos relevante para não perder agendamentos
          dateMatch = true;
        }
      } catch (err) {
        console.error('Erro ao processar data do agendamento:', err, appointment);
        // Em caso de erro, consideramos relevante para não perder agendamentos
        dateMatch = true;
      }
      
      // Filtrar por status
      const statusMatch = status === 'all' || appointment.status === status;
      console.log(`Status match: ${statusMatch} (filtro: ${status}, valor: ${appointment.status})`);
      
      // Filtrar por tipo
      const typeMatch = type === 'all' || appointment.appointmentType === type;
      console.log(`Tipo match: ${typeMatch} (filtro: ${type}, valor: ${appointment.appointmentType})`);
      
      // Filtrar por termo de busca
      let searchMatch = true;
      if (search && search.trim() !== '') {
        const searchLower = search.toLowerCase();
        const clientName = appointment.client?.name?.toLowerCase() || '';
        const therapistName = appointment.therapist?.name?.toLowerCase() || '';
        const appointmentDate = appointment.formattedDate?.toLowerCase() || '';
        
        searchMatch = 
          clientName.includes(searchLower) || 
          therapistName.includes(searchLower) || 
          appointmentDate.includes(searchLower);
        
        console.log(`Busca match: ${searchMatch} (termo: ${searchLower})`);
      }
      
      const matches = dateMatch && statusMatch && typeMatch && searchMatch;
      console.log(`Resultado final para agendamento ${appointment.id}: ${matches}`);
      
      return matches;
    });
  };
  
  // Buscar agendamentos ao montar o componente ou quando a rota mudar
  useEffect(() => {
    console.log('useEffect de busca de agendamentos acionado');
    fetchAppointments();
    // location.key como dependência garante que os agendamentos sejam recarregados na navegação
  }, [location.key]); 
  
  // Aplicar filtros quando qualquer filtro mudar
  useEffect(() => {
    console.log('Aplicando filtros aos agendamentos');
    const filtered = filterAppointments(appointments, activeTab, searchTerm, statusFilter, typeFilter);
    console.log(`Resultado da filtragem: ${filtered.length} agendamentos encontrados`);
    setFilteredAppointments(filtered);
  }, [activeTab, searchTerm, statusFilter, typeFilter, appointments]);
  
  // Manipuladores de eventos
  const handleTabChange = (tab) => {
    console.log('Mudando para a aba:', tab);
    setActiveTab(tab);
  };
  
  const handleSearch = (term) => {
    console.log('Termo de busca:', term);
    setSearchTerm(term);
  };
  
  const handleStatusChange = (value) => {
    console.log('Filtro de status:', value);
    setStatusFilter(value);
  };
  
  const handleTypeChange = (value) => {
    console.log('Filtro de tipo:', value);
    setTypeFilter(value);
  };
  
  // Manipulador para atualizar status
  const handleStatusUpdate = async (appointmentId, newStatus) => {
    try {
      await updateAppointmentStatus(appointmentId, newStatus);
      toast.success(`Status atualizado para ${newStatus}`);
      
      // Atualizar a lista de agendamentos
      const updatedAppointments = appointments.map(appointment => 
        appointment.id === appointmentId 
          ? { ...appointment, status: newStatus } 
          : appointment
      );
      
      setAppointments(updatedAppointments);
      
      // Aplicar filtros novamente
      const filtered = filterAppointments(updatedAppointments, activeTab, searchTerm, statusFilter, typeFilter);
      setFilteredAppointments(filtered);
    } catch (err) {
      console.error('Erro ao atualizar status:', err);
      toast.error(err.message || 'Erro ao atualizar status');
    }
  };

  // Calcular estado vazio
  const isEmptyState = !loading && filteredAppointments.length === 0;
  const emptyStateMessage = error 
    ? `Erro ao carregar agendamentos: ${error}` 
    : `Nenhum agendamento ${activeTab === 'upcoming' ? 'futuro' : 'passado'} encontrado`;

  return (
    <div className="p-6">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-6">
        <PageTitle title="Minha Agenda" icon={<CalendarIcon className="w-8 h-8" />} />
        
        <div className="flex flex-col md:flex-row gap-4 mt-4 md:mt-0">
          <Link 
            to="/dashboard/appointments/new" 
            className="bg-primary text-white px-4 py-2 rounded-lg shadow hover:bg-primary-dark transition-colors"
          >
            Novo Agendamento
          </Link>
        </div>
      </div>
      
      {/* Abas de Próximos e Histórico */}
      <div className="mb-6 border-b border-gray-200">
        <div className="flex space-x-6">
          <button
            className={`py-3 border-b-2 font-medium text-sm ${
              activeTab === 'upcoming'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => handleTabChange('upcoming')}
          >
            Próximos
          </button>
          <button
            className={`py-3 border-b-2 font-medium text-sm ${
              activeTab === 'history'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => handleTabChange('history')}
          >
            Histórico
          </button>
        </div>
      </div>
      
      {/* Filtros */}
      <div className="mb-6 flex flex-col md:flex-row gap-4">
        <div className="flex-grow">
          <SearchBar 
            placeholder="Buscar por nome, data..." 
            onSearch={handleSearch} 
            value={searchTerm}
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-4">
          <FilterDropdown 
            options={statusOptions} 
            value={statusFilter} 
            onChange={handleStatusChange} 
            className="w-full sm:w-40"
          />
          <FilterDropdown 
            options={typeOptions} 
            value={typeFilter} 
            onChange={handleTypeChange} 
            className="w-full sm:w-40"
          />
        </div>
      </div>
      
      {/* Estado de carregamento */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      )}
      
      {/* Estado vazio */}
      {isEmptyState && (
        <EmptyState 
          title={error ? "Erro" : "Nenhum agendamento encontrado"} 
          message={emptyStateMessage}
          icon={<CalendarIcon className="w-16 h-16 text-gray-400" />}
          actionLabel={error ? "Tentar novamente" : "Criar novo agendamento"}
          actionUrl={error ? undefined : "/dashboard/appointments/new"}
          onActionClick={error ? fetchAppointments : undefined}
        />
      )}
      
      {/* Lista de agendamentos */}
      {!loading && !isEmptyState && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAppointments.map(appointment => (
            <AppointmentCard 
              key={appointment.id}
              appointment={appointment}
              currentUser={user}
              onStatusUpdate={handleStatusUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default Appointments; 