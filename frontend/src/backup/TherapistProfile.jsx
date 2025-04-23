import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'react-toastify';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { 
  getTherapistByUserId, 
  createTherapistProfile, 
  updateTherapistProfile, 
  uploadProfilePicture,
  getTherapistById
} from '../services/therapistService';
import { THERAPY_NICHES, THERAPY_TOOLS, formatCurrency, getFullImageUrl } from '../utils/constants';
import './TherapistProfile.css';
import api from '../services/api';

// Estilo personalizado para corrigir o problema dos nichos
const customStyles = `
  .niche-card-fix {
    background-color: #ffffff !important;
    color: #333333 !important;
    border: 1px solid #e0e0e0 !important;
    text-shadow: none !important;
  }
  
  .niche-card-fix .tool-name {
    color: #333333 !important;
    text-shadow: none !important;
  }
  
  .niche-card-fix.selected {
    background-color: #e8f4fd !important;
    border-color: #4299e1 !important;
  }
  
  .niche-card-fix.selected .tool-name {
    color: #2c5282 !important;
  }
  
  .niche-card-fix input[type="checkbox"] {
    background-color: #ffffff !important;
    border-color: #333333 !important;
  }
  
  /* Seletores extremamente específicos para garantir prioridade */
  .therapist-profile .form-section .tools-grid .niche-card-fix,
  body .therapist-profile .form-section .tools-grid .niche-card-fix {
    background-color: #ffffff !important;
    color: #333333 !important;
    border: 1px solid #e0e0e0 !important;
  }
  
  .therapist-profile .form-section .tools-grid .niche-card-fix .tool-name,
  body .therapist-profile .form-section .tools-grid .niche-card-fix .tool-name {
    color: #333333 !important;
    text-shadow: none !important;
  }
  
  .therapist-profile .form-section .tools-grid .niche-card-fix.selected,
  body .therapist-profile .form-section .tools-grid .niche-card-fix.selected {
    background-color: #e8f4fd !important;
    border-color: #4299e1 !important;
  }
  
  .therapist-profile .form-section .tools-grid .niche-card-fix.selected .tool-name,
  body .therapist-profile .form-section .tools-grid .niche-card-fix.selected .tool-name {
    color: #2c5282 !important;
  }
`;

// Componente personalizado para entrada de duração
const DurationInput = ({ name = 'sessionDuration', value, onChange, min = 30, step = 30, required = false }) => {
  const handleIncrease = () => {
    onChange({ target: { name: name, value: parseInt(value) + step }});
  };

  const handleDecrease = () => {
    if (parseInt(value) > min) {
      onChange({ target: { name: name, value: parseInt(value) - step }});
    }
  };

  const handleChange = (e) => {
    let newValue = parseInt(e.target.value);
    if (isNaN(newValue)) newValue = min;
    if (newValue < min) newValue = min;
    onChange({ target: { name: name, value: newValue }});
  };

  return (
    <div className="custom-duration-input">
      <button type="button" className="duration-btn decrease" onClick={handleDecrease}>−</button>
      <input
        type="number"
        name={name}
        value={value}
        onChange={handleChange}
        min={min}
        step={step}
        required={required}
      />
      <span className="duration-label">min</span>
      <button type="button" className="duration-btn increase" onClick={handleIncrease}>+</button>
    </div>
  );
};

// Componente personalizado para entrada de valor monetário
const CurrencyInput = ({ name = 'baseSessionPrice', value, onChange, min = 0, step = 0.01, required = false }) => {
  const handleChange = (e) => {
    let newValue = parseFloat(e.target.value);
    if (isNaN(newValue)) newValue = 0;
    if (newValue < min) newValue = min;
    onChange({ target: { name: name, value: newValue }});
  };

  return (
    <div className="custom-currency-input">
      <span className="currency-prefix">R$</span>
      <input
        type="number"
        name={name}
        value={value}
        onChange={handleChange}
        min={min}
        step={step}
        required={required}
      />
    </div>
  );
};

const TherapistProfile = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [therapistId, setTherapistId] = useState(null);
  
  // Estado para gerenciar nichos e ferramentas selecionados
  const [selectedNiches, setSelectedNiches] = useState([]);
  const [customNiches, setCustomNiches] = useState(['', '', '']);
  const [selectedTools, setSelectedTools] = useState([]);
  const [customTools, setCustomTools] = useState([]);
  
  // Estado para gerenciar ferramentas e pacotes
  const [toolDurations, setToolDurations] = useState({});
  const [toolPackages, setToolPackages] = useState({});
  const [packages, setPackages] = useState([]);
  
  // Estados para recorte de imagem
  const [originalImage, setOriginalImage] = useState(null);
  const [showCropModal, setShowCropModal] = useState(false);
  const [crop, setCrop] = useState({ unit: '%', width: 80, aspect: 1, x: 10, y: 10 });
  const [completedCrop, setCompletedCrop] = useState(null);
  const imageRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const fileInputRef = useRef(null);
  
  const [formData, setFormData] = useState({
    name: '',
    shortBio: '',
    education: '',
    experience: '',
    targetAudience: '',
    differential: '',
    baseSessionPrice: '',
    sessionDuration: 60,
    profilePicture: null,
    attendanceMode: 'ONLINE',
    address: '',
    complement: '',
    neighborhood: '',
    city: '',
    state: '',
    zipCode: '',
    offersFreeSession: false,
    freeSessionDuration: 30
  });
  
  // Estado para nova ferramenta personalizada
  const [newCustomTool, setNewCustomTool] = useState('');
  
  // Efeito para carregar dados do terapeuta
  useEffect(() => {
    loadTherapistProfile();
  }, [user]);

  // Função para carregar dados do terapeuta
  const loadTherapistProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Usar o objeto user do contexto de autenticação
      if (user && user.id) {
        console.log('Buscando informações do terapeuta para o usuário:', user.id);
        const therapistResponse = await getTherapistByUserId(user.id);
        console.log('Resposta do perfil de terapeuta:', therapistResponse);
        
        if (therapistResponse && therapistResponse.id) {
          setTherapistId(therapistResponse.id);
          
          // Agora buscar detalhes completos do perfil (incluindo ferramentas)
          const profileResponse = await getTherapistById(therapistResponse.id);
          console.log('Perfil completo do terapeuta:', profileResponse);
          
          // Atualizar estados
          if (profileResponse) {
            const {
              shortBio,
              bio,
              niches,
              customNiches,
              customTools,
              education,
              experience,
              targetAudience,
              differential,
              baseSessionPrice,
              servicePrices,
              sessionDuration,
              profilePicture,
              isApproved,
              tools,
              attendanceMode,
              city,
              state,
              offersFreeSession,
              freeSessionDuration
            } = profileResponse;
            
            // Inicializar o formulário
            setFormData({
              name: profileResponse.name || '',
              shortBio: shortBio || '',
              bio: bio || '',
              education: education || '',
              experience: experience || '',
              targetAudience: targetAudience || '',
              differential: differential || '',
              baseSessionPrice: baseSessionPrice || '',
              sessionDuration: sessionDuration || 60,
              profilePicture: profilePicture || '',
              attendanceMode: attendanceMode || 'ONLINE',
              address: profileResponse.address || '',
              complement: profileResponse.complement || '',
              neighborhood: profileResponse.neighborhood || '',
              city: city || '',
              state: state || '',
              zipCode: profileResponse.zipCode || '',
              offersFreeSession: offersFreeSession || false,
              freeSessionDuration: freeSessionDuration || 30
            });
            
            // Configurar nichos
            if (niches) {
              try {
                const parsedNiches = typeof niches === 'string' ? JSON.parse(niches) : niches;
                setSelectedNiches(parsedNiches || []);
              } catch (error) {
                console.error('Erro ao processar nichos:', error);
                setSelectedNiches([]);
              }
            }
            
            // Configurar nichos personalizados
            if (customNiches) {
              try {
                let parsedCustomNiches = typeof customNiches === 'string' ? JSON.parse(customNiches) : customNiches;
                parsedCustomNiches = Array.isArray(parsedCustomNiches) ? parsedCustomNiches : [];
                
                // Garantir que temos 3 slots (mesmo que vazios)
                while (parsedCustomNiches.length < 3) {
                  parsedCustomNiches.push('');
                }
                
                setCustomNiches(parsedCustomNiches);
              } catch (error) {
                console.error('Erro ao processar nichos personalizados:', error);
                setCustomNiches(['', '', '']);
              }
            }
            
            // Configurar ferramentas personalizadas
            if (customTools) {
              try {
                const parsedCustomTools = typeof customTools === 'string' ? JSON.parse(customTools) : customTools;
                setCustomTools(Array.isArray(parsedCustomTools) ? parsedCustomTools : []);
              } catch (error) {
                console.error('Erro ao processar ferramentas personalizadas:', error);
                setCustomTools([]);
              }
            }
            
            // Configurar ferramentas predefinidas
            if (tools && Array.isArray(tools)) {
              console.log('Configurando ferramentas predefinidas:', tools);
              
              // Mapear as ferramentas recebidas para o formato usado no estado
              const mappedTools = tools.map(tool => ({
                toolId: tool.id,
                name: tool.name,
                duration: parseInt(tool.duration) || sessionDuration || 60,
                price: parseFloat(tool.price) || parseFloat(baseSessionPrice) || 0
              }));
              
              setSelectedTools(mappedTools);
              console.log('Ferramentas configuradas:', mappedTools);
            }
          }
        }
      }
    } catch (error) {
      console.error('Erro ao carregar perfil do terapeuta:', error);
      setError('Ocorreu um erro ao carregar seu perfil. Por favor, atualize a página ou tente novamente mais tarde.');
    } finally {
      setLoading(false);
    }
  };
  
  const handleGoBack = () => {
    navigate('/therapist/dashboard');
  };
  
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };
  
  // Função para lidar com a seleção de imagem para recorte
  const handleImageChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      // Verificar o tamanho do arquivo (máximo 10MB)
      if (file.size > 10 * 1024 * 1024) {
        setError('O arquivo é muito grande. Tamanho máximo: 10MB');
        return;
      }
      
      // Verificar se é uma imagem
      if (!file.type.startsWith('image/')) {
        setError('Por favor, selecione um arquivo de imagem válido.');
        return;
      }
      
      // Criar URL para a imagem
      const imageUrl = URL.createObjectURL(file);
      setOriginalImage(imageUrl);
      setShowCropModal(true);
      
      // Inicializar crop centralizado
      setCrop({
        unit: '%',
        width: 80,
        height: 80,
        x: 10,
        y: 10
      });
      
      // Limpar qualquer erro existente
      setError(null);
    }
  };
  
  // Função para gerar crop centralizado quando imagem carregar
  const onImageLoad = (e) => {
    const { width, height } = e.currentTarget;
    
    // Define a seleção inicial em 80% da imagem, mantendo-a circular
    const size = Math.min(width, height) * 0.8;
    const x = (width - size) / 2;
    const y = (height - size) / 2;
    
    setCrop({
      unit: 'px',
      width: size,
      height: size,
      x,
      y
    });
    
    // Atualizar a referência da imagem
    imageRef.current = e.currentTarget;
    
    // Inicializar completedCrop com o valor atual
    setCompletedCrop({
      unit: 'px',
      width: size,
      height: size,
      x,
      y
    });
  };
  
  // Função para desenhar o recorte na tela
  const updatePreview = useCallback(() => {
    if (!imageRef.current || !completedCrop?.width || !completedCrop?.height || !previewCanvasRef.current) {
      return;
    }
    
    const image = imageRef.current;
    const canvas = previewCanvasRef.current;
    const crop = completedCrop;
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      return;
    }
    
    // Definir o tamanho do canvas
    const pixelRatio = window.devicePixelRatio;
    canvas.width = crop.width * pixelRatio;
    canvas.height = crop.height * pixelRatio;
    
    // Escalar e ajustar qualidade
    ctx.scale(pixelRatio, pixelRatio);
    ctx.imageSmoothingQuality = 'high';
    
    // Limpar canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Desenhar recorte
    ctx.drawImage(
      image,
      crop.x * scaleX, 
      crop.y * scaleY,
      crop.width * scaleX,
      crop.height * scaleY,
      0,
      0,
      crop.width,
      crop.height
    );
  }, [completedCrop]);
  
  // Atualizar preview quando completedCrop mudar
  useEffect(() => {
    updatePreview();
  }, [completedCrop, updatePreview]);
  
  // Função para aplicar o recorte final
  const handleCropComplete = async () => {
    try {
      if (!imageRef.current || !completedCrop) {
        console.error('Referência da imagem ou crop não encontrados');
      return;
    }
      
      const canvas = document.createElement('canvas');
      const scaleX = imageRef.current.naturalWidth / imageRef.current.width;
      const scaleY = imageRef.current.naturalHeight / imageRef.current.height;
      canvas.width = completedCrop.width;
      canvas.height = completedCrop.height;
      const ctx = canvas.getContext('2d');
      
      ctx.drawImage(
        imageRef.current,
        completedCrop.x * scaleX,
        completedCrop.y * scaleY,
        completedCrop.width * scaleX,
        completedCrop.height * scaleY,
        0,
        0,
        completedCrop.width,
        completedCrop.height
      );

      canvas.toBlob(async (blob) => {
        if (!blob) {
          console.error('Falha ao criar blob da imagem');
          setError('Falha ao processar a imagem.');
          return;
        }
        
        try {
          // Criar FormData com a imagem
          const formData = new FormData();
          formData.append('profilePicture', blob, 'profile.jpg');

          console.log('Enviando imagem para o servidor...');
          const response = await uploadProfilePicture(therapistId, formData);
          console.log('Resposta do servidor:', response);

          if (response && response.profilePicture) {
            // Atualizar o estado com a nova URL da imagem
        setFormData(prev => ({
          ...prev,
              profilePicture: response.profilePicture
            }));

            // Criar um novo objeto Image para forçar o carregamento da nova imagem
            const newImage = new Image();
            const timestamp = new Date().getTime();
            newImage.src = `${response.profilePicture}?t=${timestamp}`;
            
            newImage.onload = () => {
              console.log('Nova imagem carregada com sucesso');
              // Atualizar a imagem na tela
              const imgElement = document.querySelector('.profile-image-preview');
              if (imgElement) {
                imgElement.src = newImage.src;
              }
            };

            toast.success('Foto de perfil atualizada com sucesso!');
          }
        } catch (error) {
          console.error('Erro ao fazer upload da imagem:', error);
          setError(error.message || 'Erro ao fazer upload da imagem');
          toast.error('Erro ao atualizar foto de perfil');
        }

        // Limpar e fechar o modal
        handleCancelCrop();
      }, 'image/jpeg', 0.95);
      
    } catch (error) {
      console.error('Erro ao recortar imagem:', error);
      setError('Ocorreu um erro ao processar a imagem.');
      toast.error('Erro ao processar imagem');
    }
  };
  
  // Fechamento do modal sem salvar
  const handleCancelCrop = () => {
    if (originalImage) {
      URL.revokeObjectURL(originalImage);
    }
    setShowCropModal(false);
    setOriginalImage(null);
    setCrop(null);
    setCompletedCrop(null);
  };
  
  // Alternar a seleção de um nicho
  const toggleNiche = (nicheId) => {
    setSelectedNiches(prev => {
      if (prev.includes(nicheId)) {
        return prev.filter(id => id !== nicheId);
      } else {
        return [...prev, nicheId];
      }
    });
  };
  
  // Alternar a seleção de uma ferramenta
  const toggleTool = (toolId) => {
    setSelectedTools(prev => {
      // Verificar se a ferramenta já está selecionada
      if (prev.some(t => t.toolId === toolId)) {
        // Se estiver, remover
        return prev.filter(t => t.toolId !== toolId);
      } else {
        // Se não estiver, adicionar com valores padrão
        const toolInfo = THERAPY_TOOLS.find(t => t.id === toolId);
        const defaultDuration = parseInt(formData.sessionDuration) || 60;
        const defaultPrice = parseFloat(formData.baseSessionPrice) || 0;
        
        console.log(`Adicionando ferramenta ${toolInfo.label} com duração ${defaultDuration} e preço ${defaultPrice}`);
        
        return [...prev, { 
          toolId: toolId,
          name: toolInfo.label,
          duration: defaultDuration,
          price: defaultPrice
        }];
      }
    });
  };
  
  // Atualizar nicho personalizado
  const handleCustomNicheChange = (index, value) => {
    setCustomNiches(prev => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  };
  
  // Atualizar duração da ferramenta
  const handleToolDurationChange = (toolId, duration) => {
    const durationValue = parseInt(duration) || parseInt(formData.sessionDuration) || 60;
    console.log(`Atualizando duração da ferramenta ${toolId} para ${durationValue}`);
    
    setSelectedTools(prev => 
      prev.map(tool => 
        tool.toolId === toolId 
          ? { ...tool, duration: durationValue }
          : tool
      )
    );
  };
  
  // Atualizar preço da ferramenta
  const handleToolPriceChange = (toolId, price) => {
    const priceValue = parseFloat(price) || parseFloat(formData.baseSessionPrice) || 0;
    console.log(`Atualizando preço da ferramenta ${toolId} para ${priceValue}`);
    
    setSelectedTools(prev => 
      prev.map(tool => 
        tool.toolId === toolId 
          ? { ...tool, price: priceValue }
          : tool
      )
    );
  };
  
  // Atualizar ferramenta personalizada
  const handleCustomToolChange = (index, field, value) => {
    setCustomTools(prev => {
      const updated = [...prev];
      if (field === 'name') {
        updated[index] = {
          ...updated[index],
          name: value
        };
      } else if (field === 'duration') {
        updated[index] = {
          ...updated[index],
          duration: parseInt(value) || formData.sessionDuration
        };
      } else if (field === 'price') {
        updated[index] = {
          ...updated[index],
          price: parseFloat(value) || parseFloat(formData.baseSessionPrice) || 0
        };
      }
      return updated;
    });
  };
  
  // Adicionar novo pacote
  const addPackage = (toolId) => {
    setPackages(prev => [
      ...prev,
      {
        toolId,
        name: '',
        description: '',
        sessionCount: '',
        price: '',
        validityDays: ''
      }
    ]);
  };
  
  // Atualizar pacote
  const handlePackageChange = (toolId, field, value) => {
    setToolPackages(prev => ({
      ...prev,
      [toolId]: {
        ...prev[toolId],
        [field]: field === 'sessions' || field === 'validity' ? parseInt(value) : parseFloat(value)
      }
    }));
  };
  
  // Remover pacote
  const removePackage = (index) => {
    setPackages(prev => prev.filter((_, i) => i !== index));
  };
  
  // Adicionar nova ferramenta personalizada
  const addCustomTool = () => {
    if (newCustomTool.trim() && customTools.length < 3) {
      const newTool = {
        name: newCustomTool.trim(),
        duration: parseInt(formData.sessionDuration) || 60,
        price: parseFloat(formData.baseSessionPrice) || 0
      };
      console.log('Adicionando nova ferramenta:', newTool);
      setCustomTools(prev => [...prev, newTool]);
      setNewCustomTool('');
    }
  };
  
  // Remover ferramenta personalizada
  const removeCustomTool = (index) => {
    console.log('Removendo ferramenta:', index);
    setCustomTools(prev => prev.filter((_, i) => i !== index));
  };
  
  // Alternar pacote para uma ferramenta
  const togglePackage = (toolId) => {
    setToolPackages(prev => {
      if (prev[toolId]) {
        const { [toolId]: removed, ...rest } = prev;
        return rest;
      } else {
        return {
          ...prev,
          [toolId]: {
            sessions: 4, // Valor padrão para número de sessões
            price: '', // Preço será definido pelo usuário
            validity: 30 // Valor padrão para validade em dias
          }
        };
      }
    });
  };
  
  // Adicionando função para buscar CEP
  const fetchAddressByCep = async (cep) => {
    try {
      const formattedCep = cep.replace(/\D/g, '');
      if (formattedCep.length !== 8) return;

      setLoading(true);
      const response = await fetch(`https://viacep.com.br/ws/${formattedCep}/json/`);
      const data = await response.json();
      
      if (data.erro) {
        toast.error('CEP não encontrado');
        return;
      }

      setFormData(prev => ({
        ...prev,
        address: data.logradouro || '',
        complement: data.complemento || '',
        neighborhood: data.bairro || '',
        city: data.localidade || '',
        state: data.uf || ''
      }));
    } catch (error) {
      console.error('Erro ao buscar CEP:', error);
      toast.error('Não foi possível buscar o endereço. Verifique o CEP informado.');
    } finally {
      setLoading(false);
    }
  };

  // Tratamento para CEP
  const handleZipCodeChange = (e) => {
    const { value } = e.target;
    const formattedValue = value
      .replace(/\D/g, '')
      .replace(/(\d{5})(\d)/, '$1-$2')
      .replace(/(-\d{3})\d+?$/, '$1');
    
    setFormData(prev => ({
      ...prev,
      zipCode: formattedValue
    }));

    if (formattedValue.replace(/\D/g, '').length === 8) {
      fetchAddressByCep(formattedValue);
    }
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      setSaving(true);
      setError(null);
      setSaveSuccess(false);
      
      // Filtrar ferramentas personalizadas não vazias
      const filteredCustomTools = customTools.filter(tool => tool.name.trim() !== '');
      console.log('Ferramentas personalizadas filtradas:', filteredCustomTools);
      
      // Preparar ferramentas selecionadas
      const preparedTools = selectedTools.map(tool => ({
        id: tool.toolId,
        name: tool.name,
        duration: parseInt(tool.duration) || parseInt(formData.sessionDuration) || 60,
        price: parseFloat(tool.price) || parseFloat(formData.baseSessionPrice) || 0
      }));
      console.log('Ferramentas pré-configuradas para envio:', preparedTools);
      
      // Preparar dados para envio
      const profileData = {
        name: formData.name,
        shortBio: formData.shortBio,
        niches: selectedNiches,
        customNiches: customNiches.filter(niche => niche.trim() !== ''),
        tools: preparedTools,
        customTools: filteredCustomTools,
        education: formData.education,
        experience: formData.experience,
        targetAudience: formData.targetAudience,
        differential: formData.differential,
        baseSessionPrice: parseFloat(formData.baseSessionPrice) || 0,
        sessionDuration: parseInt(formData.sessionDuration) || 60,
        attendanceMode: formData.attendanceMode,
        address: formData.address,
        complement: formData.complement,
        neighborhood: formData.neighborhood,
        city: formData.city,
        state: formData.state,
        zipCode: formData.zipCode,
        offersFreeSession: formData.offersFreeSession,
        freeSessionDuration: parseInt(formData.freeSessionDuration) || 30
      };

      console.log('Enviando dados do perfil:', JSON.stringify({
        ...profileData,
        tools: profileData.tools
      }));
      
      let response;
      if (therapistId) {
        response = await updateTherapistProfile(therapistId, profileData);
      } else {
        response = await createTherapistProfile(profileData);
        setTherapistId(response.id);
      }

      console.log('Resposta do servidor:', response);
      
      // Atualizar o estado com as ferramentas retornadas pelo servidor
      if (response.tools) {
        setSelectedTools(
          response.tools.map(tool => ({
            toolId: tool.id,
            name: tool.name,
            duration: tool.duration,
            price: tool.price
          }))
        );
      }
      
      setSaveSuccess(true);
      toast.success('Perfil salvo com sucesso!', {
        position: "top-center",
        autoClose: 5000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
      });
      
      // Recarregar os dados do perfil
      await loadTherapistProfile();
      
    } catch (err) {
      console.error('Erro ao salvar perfil:', err);
      setError('Ocorreu um erro ao salvar o perfil. Por favor, tente novamente.');
      toast.error('Erro ao salvar perfil. Por favor, verifique os dados e tente novamente.', {
        position: "top-center",
        autoClose: 5000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
      });
    } finally {
      setSaving(false);
      // Rolar para o topo da página para mostrar a mensagem
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
  };

  const handleCheckboxChange = (e) => {
    const { name, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: checked
    }));
  };

  return (
    <div className="therapist-profile">
      {/* Aplicar estilos inline para corrigir problema dos nichos */}
      <style dangerouslySetInnerHTML={{ __html: customStyles }} />
      
      <div className="page-header">
        <button onClick={handleGoBack} className="back-button">
          ← Voltar
        </button>
        <h1>Perfil Profissional</h1>
      </div>
      
      {error && (
        <div className="error-message alert">
          <div className="alert-icon">⚠️</div>
          <div className="alert-content">{error}</div>
        </div>
      )}
      
      {saveSuccess && (
        <div className="success-message alert">
          <div className="alert-icon">✓</div>
          <div className="alert-content">Perfil atualizado com sucesso! As informações já estão disponíveis em seu perfil público.</div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="profile-form">
        {/* Seção 1: Informações Básicas */}
        <div className="form-section">
          <h2><span className="step-number">1</span>Informações Básicas</h2>
          
          <div className="profile-image-section">
            <div className="image-preview">
              {formData.profilePicture ? (
                <img 
                  src={`${getFullImageUrl(formData.profilePicture)}?t=${Date.now()}`}
                  alt="Foto de perfil" 
                />
              ) : (
                <div className="profile-image-placeholder">
                  <span>{user?.name?.charAt(0) || '?'}</span>
                </div>
              )}
            </div>
            <button 
              type="button" 
              className="image-upload-button"
              onClick={() => fileInputRef.current?.click()}
            >
              {formData.profilePicture ? 'Alterar foto' : 'Adicionar foto'}
            </button>
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleImageChange}
              accept="image/*"
              style={{ display: 'none' }}
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="name" className="required-field">Nome Completo</label>
            <input 
              type="text" 
              id="name" 
              name="name" 
              value={formData.name}
              onChange={handleInputChange}
              placeholder="Seu nome completo como profissional"
              required
            />
            <small className="form-tip">Este nome será exibido em seu perfil público.</small>
          </div>

          <div className="form-group">
            <label htmlFor="shortBio" className="required-field">Mini Biografia</label>
            <textarea 
              id="shortBio" 
              name="shortBio" 
              value={formData.shortBio}
              onChange={handleInputChange}
              placeholder="Conte um pouco sobre você e sua abordagem terapêutica..."
              required
            />
            <small className="form-tip">Esta será a primeira impressão que os clientes terão de você.</small>
          </div>
          
          <div className="form-group">
            <label htmlFor="education" className="required-field">Formações e Certificados</label>
            <textarea 
              id="education" 
              name="education" 
              value={formData.education}
              onChange={handleInputChange}
              placeholder="Descreva suas formações, certificações e especializações..."
              required
            />
            <small className="form-tip">Ex: Certificação em Thetahealing, Formação em Constelação Familiar, Curso de Reiki nível 3</small>
          </div>
          
          <div className="form-group">
            <label htmlFor="experience" className="required-field">Experiência Profissional</label>
            <textarea 
              id="experience" 
              name="experience" 
              value={formData.experience}
              onChange={handleInputChange}
              placeholder="Descreva sua experiência profissional..."
              required
            />
            <small className="form-tip">Ex: 5 anos de atendimento em consultório particular, 3 anos realizando atendimentos online, experiência com grupos terapêuticos</small>
          </div>

          <div className="form-group">
            <label htmlFor="targetAudience" className="required-field">Público-Alvo</label>
            <textarea 
              id="targetAudience" 
              name="targetAudience" 
              value={formData.targetAudience}
              onChange={handleInputChange}
              placeholder="Descreva o público com quem você prefere trabalhar..."
              required
            />
            <small className="form-tip">Ex: Adultos, adolescentes, casais, pessoas com transtornos de ansiedade</small>
          </div>

          <div className="form-group">
            <label htmlFor="differential" className="required-field">Diferencial</label>
            <textarea 
              id="differential" 
              name="differential" 
              value={formData.differential}
              onChange={handleInputChange}
              placeholder="O que torna seu trabalho terapêutico único ou especial?"
              required
            />
            <small className="form-tip">Ex: Abordagem integrativa que combina TCC com técnicas mindfulness</small>
          </div>
          
          <div className="form-group">
            <label className="required-field">Modalidade de Atendimento</label>
            <div className="attendance-options">
              <div className="attendance-option">
                <input 
                  type="radio" 
                  id="online" 
                  name="attendanceMode" 
                  value="ONLINE" 
                  checked={formData.attendanceMode === 'ONLINE'}
                  onChange={handleInputChange}
                />
                <label htmlFor="online">Apenas Online</label>
              </div>
              
              <div className="attendance-option">
                <input 
                  type="radio" 
                  id="presential" 
                  name="attendanceMode" 
                  value="PRESENTIAL" 
                  checked={formData.attendanceMode === 'PRESENTIAL'}
                  onChange={handleInputChange}
                />
                <label htmlFor="presential">Apenas Presencial</label>
              </div>
              
              <div className="attendance-option">
                <input 
                  type="radio" 
                  id="hybrid" 
                  name="attendanceMode" 
                  value="HYBRID" 
                  checked={formData.attendanceMode === 'HYBRID'}
                  onChange={handleInputChange}
                />
                <label htmlFor="hybrid">Ambos (Presencial e Online)</label>
              </div>
            </div>
          </div>
          
          {(formData.attendanceMode === 'PRESENTIAL' || formData.attendanceMode === 'HYBRID') && (
            <div className="address-section">
              <h3>Endereço do Consultório</h3>
              
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="zipCode" className="required-field">CEP</label>
                  <input
                    type="text"
                    id="zipCode"
                    name="zipCode"
                    value={formData.zipCode}
                    onChange={handleZipCodeChange}
                    placeholder="00000-000"
                    maxLength="9"
                    required
                  />
                  <small className="form-tip">Digite o CEP para auto-preencher o endereço</small>
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="address" className="required-field">Endereço</label>
                  <input
                    type="text"
                    id="address"
                    name="address"
                    value={formData.address}
                    onChange={handleInputChange}
                    placeholder="Rua, Avenida, etc."
                    required
                  />
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="complement">Complemento</label>
                  <input
                    type="text"
                    id="complement"
                    name="complement"
                    value={formData.complement}
                    onChange={handleInputChange}
                    placeholder="Sala, Andar, Referência, etc."
                  />
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="neighborhood" className="required-field">Bairro</label>
                  <input
                    type="text"
                    id="neighborhood"
                    name="neighborhood"
                    value={formData.neighborhood}
                    onChange={handleInputChange}
                    placeholder="Bairro"
                    required
                  />
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="city" className="required-field">Cidade</label>
                  <input
                    type="text"
                    id="city"
                    name="city"
                    value={formData.city}
                    onChange={handleInputChange}
                    placeholder="Cidade"
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="state" className="required-field">Estado</label>
                  <input
                    type="text"
                    id="state"
                    name="state"
                    value={formData.state}
                    onChange={handleInputChange}
                    placeholder="UF"
                    maxLength="2"
                    required
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        
        {/* Seção 2: Nichos de Atuação */}
        <div className="form-section">
          <h2><span className="step-number">2</span>Nichos de Atuação</h2>
          <p className="section-description">
            Selecione os nichos em que você atua. Isso ajudará os clientes a encontrarem o profissional mais adequado.
          </p>
          
          <div className="tools-grid">
            {THERAPY_NICHES.map(niche => (
              <div 
                key={niche.id}
                className={`tool-item niche-card-fix ${selectedNiches.includes(niche.id) ? 'selected' : ''}`}
              >
                <div className="tool-header">
                  <span className="tool-name">{niche.label}</span>
                  <input
                    type="checkbox"
                    checked={selectedNiches.includes(niche.id)}
                    onChange={() => toggleNiche(niche.id)}
                  />
                </div>
              </div>
            ))}
          </div>
          
          <div className="custom-tools-section">
            <h3>Nichos Personalizados</h3>
            <p className="section-description">
              Adicione até 3 nichos personalizados que não estejam na lista acima.
            </p>
            <div className="tools-grid">
              {customNiches.map((niche, index) => (
                <div 
                  key={index} 
                  className="tool-item niche-card-fix"
                >
                  <div className="tool-header">
                    <input
                      type="text"
                      value={niche}
                      onChange={(e) => handleCustomNicheChange(index, e.target.value)}
                      placeholder="Digite o nicho..."
                      className="custom-tool-input"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        {/* Seção 3: Valores e Duração da Sessão */}
        <div className="form-section pricing-section">
          <h2><span className="step-number">3</span>Valores e Duração da Sessão</h2>
          <p className="section-description">
            Configure o valor e a duração padrão das suas sessões. 
            Estes valores serão usados como base para todas as suas ferramentas terapêuticas.
          </p>

          <div className="base-price-section">
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="baseSessionPrice" className="required-field">Valor</label>
                <CurrencyInput
                  name="baseSessionPrice"
                  value={formData.baseSessionPrice}
                  onChange={handleInputChange}
                  min={0}
                  step={0.01}
                  required
                />
                <small className="form-tip">Este será o valor padrão para todas as suas sessões e ferramentas.</small>
              </div>
              
              <div className="form-group">
                <label htmlFor="sessionDuration" className="required-field">Duração</label>
                <DurationInput
                  name="sessionDuration"
                  value={formData.sessionDuration}
                  onChange={handleInputChange}
                  min={30}
                  step={30}
                  required
                />
                <small className="form-tip">Duração em minutos</small>
              </div>
            </div>
          </div>
          
          {/* Ferramentas Terapêuticas */}
          <div className="tools-section">
            <h3>Ferramentas Terapêuticas</h3>
            <p className="section-description">
              Selecione as ferramentas que você utiliza em suas sessões. 
              Por padrão, cada ferramenta terá o mesmo valor e duração da sessão base.
            </p>

            <div className="tools-grid">
              {THERAPY_TOOLS.map(tool => (
                <div 
                  key={tool.id}
                  className={`tool-item ${selectedTools.some(t => t.toolId === tool.id) ? 'selected' : ''}`}
                  style={{backgroundColor: '#ffffff', color: '#333333', border: '1px solid #e0e0e0'}}
                >
                  <div className="tool-header">
                    <span className="tool-name" style={{color: '#333333'}}>{tool.label}</span>
                    <input
                      type="checkbox"
                      checked={selectedTools.some(t => t.toolId === tool.id)}
                      onChange={() => toggleTool(tool.id)}
                    />
                  </div>
                  
                  {selectedTools.some(t => t.toolId === tool.id) && (
                    <div className="tool-config">
                      <div className="config-row">
                        <div className="config-group">
                          <label>Duração</label>
                          <DurationInput
                            name={`toolDuration-${tool.id}`}
                            value={selectedTools.find(t => t.toolId === tool.id)?.duration || formData.sessionDuration}
                            onChange={(e) => handleToolDurationChange(tool.id, e.target.value)}
                            min={30}
                            step={30}
                          />
                        </div>
                        
                        <div className="config-group">
                          <label>Valor</label>
                          <CurrencyInput
                            name={`toolPrice-${tool.id}`}
                            value={selectedTools.find(t => t.toolId === tool.id)?.price || formData.baseSessionPrice}
                            onChange={(e) => handleToolPriceChange(tool.id, e.target.value)}
                            min={0}
                            step={0.01}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            
            <div className="custom-tools-section">
              <h3>Ferramentas Personalizadas</h3>
              <p className="section-description">
                Adicione até 3 ferramentas personalizadas que não estejam na lista acima.
              </p>

              <div className="tools-grid">
                {customTools.map((tool, index) => (
                  <div key={index} className="tool-item">
                    <div className="tool-header">
                      <input
                        type="text"
                        value={tool.name}
                        onChange={(e) => handleCustomToolChange(index, 'name', e.target.value)}
                        placeholder="Nome da ferramenta..."
                        className="custom-tool-input"
                      />
                      <button
                        type="button"
                        className="remove-tool-button"
                        onClick={() => removeCustomTool(index)}
                      >
                        ×
                      </button>
                    </div>
                    <div className="tool-config">
                      <div className="config-row">
                        <div className="config-group">
                          <label>Duração</label>
                          <DurationInput
                            name={`customToolDuration-${index}`}
                            value={tool.duration}
                            onChange={(e) => handleCustomToolChange(index, 'duration', e.target.value)}
                            min={30}
                            step={30}
                          />
                        </div>
                        <div className="config-group">
                          <label>Valor</label>
                          <CurrencyInput
                            name={`customToolPrice-${index}`}
                            value={tool.price}
                            onChange={(e) => handleCustomToolChange(index, 'price', e.target.value)}
                            min={0}
                            step={0.01}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {customTools.length < 3 && (
                  <div className="tool-item add-tool">
                    <div className="tool-header">
                      <input
                        type="text"
                        value={newCustomTool}
                        onChange={(e) => setNewCustomTool(e.target.value)}
                        placeholder="Nova ferramenta..."
                        className="custom-tool-input"
                      />
                      <button
                        type="button"
                        className="add-tool-button"
                        onClick={addCustomTool}
                        disabled={!newCustomTool.trim()}
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        
        {/* Seção 4: Sessão Experimental */}
        <div className="form-section">
          <h2><span className="step-number">4</span>Sessão Experimental</h2>
          <p className="section-description">
            Oferecer uma sessão experimental gratuita pode ajudar novos clientes a conhecerem seu trabalho.
            Cada cliente pode realizar até 2 sessões gratuitas com terapeutas diferentes na plataforma.
          </p>
          
          <div className="form-group checkbox-group">
            <input
              type="checkbox"
              id="offersFreeSession"
              name="offersFreeSession"
              checked={formData.offersFreeSession}
              onChange={handleCheckboxChange}
            />
            <label htmlFor="offersFreeSession">
              Oferecer sessão experimental gratuita para novos clientes
            </label>
          </div>
          
          {formData.offersFreeSession && (
            <div className="form-group">
              <label htmlFor="freeSessionDuration">Duração da sessão experimental</label>
              <div className="duration-input">
                <select
                  id="freeSessionDuration"
                  name="freeSessionDuration"
                  value={formData.freeSessionDuration}
                  onChange={handleInputChange}
                >
                  <option value="15">15 minutos</option>
                  <option value="20">20 minutos</option>
                  <option value="30">30 minutos</option>
                </select>
              </div>
              <small className="form-tip">
                Recomendamos uma duração entre 15 e 30 minutos para sessões experimentais.
              </small>
            </div>
          )}
        </div>
        
        <div className="form-actions">
          <button 
            type="button"
            className="cancel-button"
            onClick={handleGoBack}
          >
            Cancelar
          </button>
          <button 
            type="submit" 
            className="save-button"
            disabled={saving}
          >
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      </form>

      {/* Modal de recorte de imagem */}
      {showCropModal && (
        <div className="crop-modal">
          <div className="crop-modal-content">
            <h3>Ajustar Foto de Perfil</h3>
            
            <div className="crop-container">
              {originalImage && (
                <ReactCrop
                  crop={crop}
                  onChange={(c) => setCrop(c)}
                  onComplete={(c) => setCompletedCrop(c)}
                  aspect={1}
                  circularCrop
                >
                  <img
                    ref={imageRef}
                    alt="Imagem para recorte"
                    src={originalImage}
                    style={{ maxHeight: '70vh' }}
                    onLoad={onImageLoad}
                  />
                </ReactCrop>
              )}
            </div>
            
            <div className="crop-preview">
              <h4>Prévia</h4>
              <canvas
                ref={previewCanvasRef}
                style={{
                  width: Math.round(completedCrop?.width ?? 0),
                  height: Math.round(completedCrop?.height ?? 0),
                  borderRadius: '50%',
                  objectFit: 'contain'
                }}
              />
            </div>
            
            <div className="crop-actions">
              <button
                type="button"
                onClick={() => {
                  setShowCropModal(false);
                  setOriginalImage(null);
                }} 
                className="cancel-button"
              >
                Cancelar
              </button>
              <button 
                type="button" 
                onClick={handleCropComplete}
                className="save-button"
                disabled={!completedCrop?.width || !completedCrop?.height}
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TherapistProfile; 