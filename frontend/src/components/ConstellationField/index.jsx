import React, { useRef, useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls, Html, useGLTF, PerspectiveCamera, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { TextureLoader } from 'three';
import './ConstellationField.css';
import { ConstellationProvider, ConstellationContext } from '../../contexts/ConstellationContext';
import Field from './Field';
import ControlTransfer from './ControlTransfer';

// Cores para os representantes
const REPRESENTATIVE_COLORS = [
  '#4285F4', '#EA4335', '#FBBC05', '#34A853',
  '#FF6D01', '#46BDC6', '#9C27B0', '#795548',
  '#FFFFFF', '#000000'
];

// Tipos de representantes
const REPRESENTATIVE_TYPES = {
  MALE_ELDER: {
    id: 'male_elder',
    name: 'Idoso Masculino',
    modelPath: '/representantes/06 - Representante Idoso Masculino.glb'
  },
  FEMALE_ELDER: {
    id: 'female_elder',
    name: 'Idoso Feminino',
    modelPath: '/representantes/05 - Representante Idoso Feminino.glb'
  },
  MALE_ADULT: {
    id: 'male_adult',
    name: 'Adulto Masculino',
    modelPath: '/representantes/01 - Representante Adulto Masculino.glb'
  },
  FEMALE_ADULT: {
    id: 'female_adult',
    name: 'Adulto Feminino',
    modelPath: '/representantes/02 - Representante Adulto Feminino.glb'
  },
  MALE_CHILD: {
    id: 'male_child',
    name: 'Criança Masculino',
    modelPath: '/representantes/04 - Representante Criança Masculino.glb'
  },
  FEMALE_CHILD: {
    id: 'female_child',
    name: 'Criança Feminino',
    modelPath: '/representantes/03 - Representante Criança Feminino.glb'
  },
  SUBJETIVO_LONGO: {
    id: 'subjetivo_longo',
    name: 'Subjetivo Longo',
    modelPath: '/representantes/Subjetivo Longo.glb'
  },
  SUBJETIVO_CURTO: {
    id: 'subjetivo_curto',
    name: 'Subjetivo Curto',
    modelPath: '/representantes/Subjetivo curto.glb'
  }
};

// Carregar todos os modelos antecipadamente
// Preload dos modelos para garantir disponibilidade
useGLTF.preload(REPRESENTATIVE_TYPES.MALE_ELDER.modelPath);
useGLTF.preload(REPRESENTATIVE_TYPES.FEMALE_ELDER.modelPath);
useGLTF.preload(REPRESENTATIVE_TYPES.MALE_ADULT.modelPath);
useGLTF.preload(REPRESENTATIVE_TYPES.FEMALE_ADULT.modelPath);
useGLTF.preload(REPRESENTATIVE_TYPES.MALE_CHILD.modelPath);
useGLTF.preload(REPRESENTATIVE_TYPES.FEMALE_CHILD.modelPath);
useGLTF.preload(REPRESENTATIVE_TYPES.SUBJETIVO_LONGO.modelPath);
useGLTF.preload(REPRESENTATIVE_TYPES.SUBJETIVO_CURTO.modelPath);

// Função auxiliar para normalizar representantes
const normalizeRepresentatives = (reps) => {
  if (!Array.isArray(reps)) {
    console.warn("Representantes não são um array", reps);
    return [];
  }

  return reps.map(rep => {
    if (!rep) return null;
    
    // Garantir que temos um formato válido
    const normalizedRep = { ...rep };
    
    // Assegurar que position está no formato correto (array)
    if (normalizedRep.position) {
      if (typeof normalizedRep.position === 'object' && 'x' in normalizedRep.position) {
        // Já está no formato correto de objeto
      } else if (Array.isArray(normalizedRep.position)) {
        // Converter array para objeto
        normalizedRep.position = {
          x: normalizedRep.position[0] || 0,
          y: normalizedRep.position[1] || 0,
          z: normalizedRep.position[2] || 0
        };
      } else {
        console.warn("Formato de posição desconhecido", normalizedRep.position);
        normalizedRep.position = { x: 0, y: 0, z: 0 };
      }
    } else {
      normalizedRep.position = { x: 0, y: 0, z: 0 };
    }
    
    return normalizedRep;
  }).filter(Boolean); // Remover null/undefined
};

// Componente para o campo de constelação
const ConstellationField = ({ isHost = true, sessionId = null, fieldTexture = "/white-circle.png" }) => {
  // Checar se já existe um contexto (para evitar nesting desnecessário)
  const existingContext = useContext(ConstellationContext);
  console.log('ConstellationField: Verificando contexto existente:', !!existingContext);
  
  // Estado para controlar erros
  const [hasError, setHasError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Usar useMemo para evitar re-renderizações desnecessárias
  const memoizedProvider = useMemo(() => {
    try {
      // Se já temos um contexto, apenas renderizar a view
      if (existingContext) {
        console.log('ConstellationField: Usando contexto existente');
        return <ConstellationView fieldTexture={fieldTexture} />;
      }
      
      // Caso contrário, envolver com o Provider
      console.log('ConstellationField: Criando novo provider com sessionId:', sessionId);
  return (
    <ConstellationProvider isHost={isHost} sessionId={sessionId}>
      <ConstellationView fieldTexture={fieldTexture} />
    </ConstellationProvider>
  );
    } catch (error) {
      console.error('Erro ao renderizar ConstellationField:', error);
      setHasError(true);
      setErrorMsg(error.message || 'Erro ao inicializar o campo de constelação');
      return (
        <div className="constellation-error-boundary">
          <h3>Erro ao carregar o campo de constelação</h3>
          <p>{error.message}</p>
          <button onClick={() => window.location.reload()}>Recarregar página</button>
        </div>
      );
    }
  }, [isHost, sessionId, fieldTexture, existingContext]);
  
  // Verificar e garantir que o socket esteja disponível globalmente
  useEffect(() => {
    if (sessionId) {
      // Verificar se o socket está disponível
      const hasSocket = window.socket || window.constellationSocket;
      if (!hasSocket) {
        console.warn('ConstellationField: Socket não encontrado no objeto window');
      } else {
        console.log('ConstellationField: Socket disponível com ID:', hasSocket.id);
        // Garantir que o socket esteja na sala correta
        if (hasSocket.connected) {
          hasSocket.emit('join-session', { sessionId });
        }
      }
    }
  }, [sessionId]);

  // Se há um erro, mostrar a mensagem
  if (hasError) {
    return (
      <div className="constellation-error-container">
        <h3>Erro ao carregar o campo de constelação</h3>
        <p>{errorMsg}</p>
        <button onClick={() => window.location.reload()}>Recarregar página</button>
      </div>
    );
  }

  return memoizedProvider;
};

// Componente de visualização que usa o ConstellationContext
const ConstellationView = ({ fieldTexture }) => {
  // Usamos try/catch para ter uma melhor mensagem de erro se o contexto não estiver disponível
  let contextValues;
  try {
    contextValues = useContext(ConstellationContext);
    
    console.log('ConstellationView: Contexto obtido:', contextValues ? 'disponível' : 'indisponível');
    
    if (!contextValues) {
      console.error('ConstellationView: ConstellationContext não está disponível');
      return (
        <div className="constellation-error">
          <h3>Erro: Contexto da Constelação não disponível</h3>
          <p>Tente recarregar a página ou contate o suporte técnico.</p>
        </div>
      );
    }
  } catch (error) {
    console.error('Erro ao acessar ConstellationContext:', error);
    return (
      <div className="constellation-error">
        <h3>Erro ao inicializar o campo de constelação</h3>
        <p>{error.message}</p>
      </div>
    );
  }
  
  // Desestruturar as props do contexto com verificação de existência
  const { 
    representatives = [], 
    selectedRepresentative = null, 
    representativeName = '', 
    selectedType = '',
    selectedColor = '',
    hasControl = false,
    showDragHint = false,
    editingId = null,
    editName = '',
    editColor = '',
    isDraggingAny = false,
    showNames = true,
    plateRotation = 0,
    cameraPosition = { x: 0, y: 10, z: 10 },
    cameraTarget = { x: 0, y: 0, z: 0 },
    setRepresentativeName = () => {},
    setSelectedType = () => {},
    setSelectedColor = () => {},
    addRepresentative = () => {},
    startEditing = () => {},
    saveEditing = () => {},
    cancelEditing = () => {},
    removeRepresentative = () => {},
    transferControl = () => {},
    saveConfiguration = () => {},
    setShowNames = () => {},
    setEditName = () => {},
    setEditColor = () => {},
    REPRESENTATIVE_COLORS = [],
    REPRESENTATIVE_TYPES = {},
    handleRepresentativeSelect = () => {},
    setRepresentativePosition = () => {},
    setDraggingState = () => {},
    setPlateRotation = () => {},
    setCameraPosition = () => {}
  } = contextValues || {};

  // Normalizar os representantes para garantir que estão no formato correto
  const normalizedRepresentatives = useMemo(() => {
    console.log("Normalizando representantes:", representatives);
    if (representatives.length > 0) {
      console.log("Primeiro representante (antes):", representatives[0]);
    }
    
    const normalized = normalizeRepresentatives(representatives);
    
    if (normalized.length > 0) {
      console.log("Primeiro representante (depois):", normalized[0]);
    }
    
    return normalized;
  }, [representatives]);

  // Referência para o controle de órbita
  const orbitControlsRef = useRef();
  const [showAddPanel, setShowAddPanel] = useState(false);

  // Este useEffect controla a emissão de atualizações de câmera a cada 300ms
  useEffect(() => {
    // Primeiro verificamos se já temos controls
    if (!orbitControlsRef.current || !hasControl) return;

    // Controla os eventos de mudança na câmera
    const handleCameraChange = (e) => {
      if (orbitControlsRef.current) {
        // Obter a posição atual da câmera e o alvo
        const camera = orbitControlsRef.current.object;
        const target = orbitControlsRef.current.target;
        
        // Emitir a mudança
        setCameraPosition(
          { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          { x: target.x, y: target.y, z: target.z }
        );
        
        // Emitir mudança na rotação do prato (que neste caso é a rotação Y da posição da câmera)
        const angleY = Math.atan2(camera.position.x, camera.position.z);
        setPlateRotation(angleY);
        
        console.log("Emitindo atualização de câmera e rotação do prato");
      }
    };

    // Debounce para não sobrecarregar o socket
    let timeout;
    const debouncedHandleCameraChange = () => {
      clearTimeout(timeout);
      timeout = setTimeout(handleCameraChange, 300);
    };

    // Adicionar listeners ao controle de órbita
    const controls = orbitControlsRef.current;
    controls.addEventListener('change', debouncedHandleCameraChange);
    controls.addEventListener('end', handleCameraChange);

    return () => {
      if (controls) {
        controls.removeEventListener('change', debouncedHandleCameraChange);
        controls.removeEventListener('end', handleCameraChange);
      }
      clearTimeout(timeout);
    };
  }, [hasControl, setCameraPosition, setPlateRotation]);

  return (
    <div className="constellation-field-container">
      <div className="constellation-controls">
        {/* Painel lateral para opções */}
        <div className="control-panel">
          <h3 className="panel-title">Representantes</h3>
          
          {/* Adicionar um novo representante */}
          <div className="add-representative">
            <input
              type="text"
              value={representativeName}
              onChange={(e) => setRepresentativeName(e.target.value)}
              placeholder="Nome do representante"
              className="name-input"
            />
            
            <div className="type-selection">
              <select 
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="type-dropdown"
              >
                {Object.values(REPRESENTATIVE_TYPES).map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="color-selection">
              {REPRESENTATIVE_COLORS.map((color, index) => {
                // Adicionar bordas especiais para branco e preto
                const isWhite = color === '#FFFFFF';
                const isBlack = color === '#000000';
                
                // Estilos especiais para branco e preto
                const specialStyle = {};
                if (isWhite) {
                  specialStyle.border = '2px solid #aaa';
                  specialStyle.boxShadow = '0 0 4px rgba(0,0,0,0.2)';
                } else if (isBlack) {
                  specialStyle.border = '2px solid #666';
                  specialStyle.boxShadow = '0 0 4px rgba(255,255,255,0.2)';
                } else if (selectedColor === color) {
                  specialStyle.border = '2px solid #333';
                } else {
                  specialStyle.border = '2px solid transparent';
                }
                
                return (
                  <div 
                    key={index}
                    className={`color-option ${selectedColor === color ? 'selected' : ''}`}
                    style={{ 
                      backgroundColor: color,
                      ...specialStyle
                    }}
                    onClick={() => setSelectedColor(color)}
                    title={isWhite ? 'Branco' : isBlack ? 'Preto' : color}
                  />
                );
              })}
            </div>
            
            <button 
              onClick={() => {
                console.log("Adicionando representante com tipo:", selectedType);
                addRepresentative();
              }}
              className="add-btn"
              disabled={!hasControl || representativeName.trim() === ''}
            >
              + Adicionar
            </button>
          </div>
          
          {/* Lista de representantes */}
          <div className="representatives-list">
            {normalizedRepresentatives.map((rep) => (
              <div key={rep.id} className="representative-item">
                {editingId === rep.id ? (
                  // Modo de edição
                  <div className="edit-mode">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="edit-name-input"
                      autoFocus
                    />
                    
                    <div className="edit-color-selection">
                      {REPRESENTATIVE_COLORS.map((color, index) => {
                        const isWhite = color === '#FFFFFF';
                        const isBlack = color === '#000000';
                        
                        // Estilos especiais para branco e preto
                        const specialStyle = {};
                        if (isWhite) {
                          specialStyle.border = '2px solid #aaa';
                          specialStyle.boxShadow = '0 0 4px rgba(0,0,0,0.2)';
                        } else if (isBlack) {
                          specialStyle.border = '2px solid #666';
                          specialStyle.boxShadow = '0 0 4px rgba(255,255,255,0.2)';
                        } else if (editColor === color) {
                          specialStyle.border = '2px solid #333';
                        } else {
                          specialStyle.border = '2px solid transparent';
                        }
                        
                        return (
                          <div 
                            key={index}
                            className={`color-option mini ${editColor === color ? 'selected' : ''}`}
                            style={{ 
                              backgroundColor: color,
                              ...specialStyle
                            }}
                            onClick={() => setEditColor(color)}
                            title={isWhite ? 'Branco' : isBlack ? 'Preto' : color}
                          />
                        );
                      })}
                    </div>
                    
                    <div className="edit-actions">
                      <button 
                        className="save-edit-btn"
                        onClick={() => {
                          console.log('Salvando edições:', editName, editColor);
                          saveEditing();
                        }}
                        title="Salvar alterações"
                      >
                        ✓
                      </button>
                      <button 
                        className="cancel-edit-btn"
                        onClick={() => {
                          console.log('Cancelando edição');
                          cancelEditing();
                        }}
                        title="Cancelar edição"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ) : (
                  // Modo de visualização
                  <>
                    <div 
                      className="color-indicator" 
                      style={{ backgroundColor: rep.color }}
                    />
                    <div className="name">
                      {rep.name}
                    </div>
                    <div className="type-indicator">
                      {Object.values(REPRESENTATIVE_TYPES).find(t => t.id === rep.type)?.name.split(' ')[0]}
                    </div>
                    <div className="item-actions">
                      <button 
                        className="edit-btn"
                        onClick={() => startEditing(rep)}
                        title="Editar representante"
                      >
                        ✎
                      </button>
                      <button 
                        className="remove-btn"
                        onClick={() => removeRepresentative(rep.id)}
                        title="Remover representante"
                      >
                        ✕
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          
          {/* Botões de controle */}
          <div className="control-buttons">
            <button 
              onClick={transferControl}
              className="control-button"
              disabled={!hasControl}
            >
              Passar
            </button>
            
            <button 
              onClick={saveConfiguration}
              className="control-button"
            >
              Salvar
            </button>
            
            <button 
              onClick={() => setShowNames(!showNames)}
              className="control-button view-toggle"
            >
              {showNames ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </div>
        
        {hasControl && (
          <div className="control-status">
            <div className="status-indicator"></div>
            <span>Controle ativo</span>
          </div>
        )}
        
        {!hasControl && (
          <div className="control-status observer">
            <div className="status-indicator"></div>
            <span>Observador</span>
          </div>
        )}
      </div>
      
      <div className="canvas-container">
        <Canvas 
          shadows 
          camera={{ position: [0, 10, 10], fov: 45 }}
          style={{ background: '#111' }}
          gl={{ 
            antialias: true,
            alpha: false,
            preserveDrawingBuffer: true,
            powerPreference: "high-performance"
          }}
        >
          <PerspectiveCamera 
            makeDefault 
            position={[cameraPosition.x, cameraPosition.y, cameraPosition.z]} 
            fov={50} 
            near={0.1} 
            far={1000}
          />
          <Environment preset="studio" />
          <ambientLight intensity={0.8} />
          <directionalLight
            position={[5, 10, 5]} 
            intensity={0.8}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-far={50}
            shadow-camera-left={-20}
            shadow-camera-right={20}
            shadow-camera-top={20}
            shadow-camera-bottom={-20}
          />
          <pointLight position={[3, 5, 3]} intensity={0.4} />
          <pointLight position={[-3, 5, -3]} intensity={0.4} />
          <spotLight
            position={[0, 8, 0]}
            intensity={0.3}
            angle={Math.PI / 4}
            penumbra={0.2}
            castShadow
          />

          <mesh 
            position={[0, 0, 0]} 
            rotation={[-Math.PI / 2, 0, 0]} 
            receiveShadow
            castShadow
            onClick={(e) => {
              e.stopPropagation();
              handleRepresentativeSelect && handleRepresentativeSelect(null);
            }}
          >
            <circleGeometry args={[5, 64]} />
            <meshPhysicalMaterial 
              color="#000000"
              metalness={0.7}
              roughness={0.2}
              clearcoat={0.8}
              clearcoatRoughness={0.2}
              reflectivity={0.8}
              side={THREE.DoubleSide}
            />
          </mesh>

          {/* Círculos decorativos com linhas mais brilhantes */}
          <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[4.5, 4.55, 64]} />
            <meshStandardMaterial 
              color="#888888" 
              metalness={0.9}
              roughness={0.1}
              emissive="#ffffff"
              emissiveIntensity={0.1}
            />
          </mesh>
          <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[3.5, 3.55, 64]} />
            <meshStandardMaterial 
              color="#888888"
              metalness={0.9}
              roughness={0.1}
              emissive="#ffffff"
              emissiveIntensity={0.1}
            />
          </mesh>
          <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[2.5, 2.55, 64]} />
            <meshStandardMaterial 
              color="#888888"
              metalness={0.9}
              roughness={0.1}
              emissive="#ffffff"
              emissiveIntensity={0.1}
            />
          </mesh>
          <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.5, 1.55, 32]} />
            <meshStandardMaterial 
              color="#888888"
              metalness={0.9}
              roughness={0.1}
              emissive="#ffffff"
              emissiveIntensity={0.1}
            />
          </mesh>

          <Field 
            fieldTexture={fieldTexture} 
            representatives={normalizedRepresentatives}
            selectedRepresentative={selectedRepresentative}
            onSelectionChange={handleRepresentativeSelect}
            onPositionChange={setRepresentativePosition}
            onDragChange={setDraggingState}
            canMove={hasControl}
          />
          <OrbitControls 
            ref={orbitControlsRef}
            makeDefault
            enablePan={true}
            screenSpacePanning={true}
            maxPolarAngle={Math.PI / 2.2}
            minPolarAngle={Math.PI / 6}
            enableRotate={!isDraggingAny && hasControl}
            maxDistance={15}
            minDistance={4}
            enabled={!isDraggingAny && hasControl}
            keyPanSpeed={15}
            panSpeed={1.5}
            enableDamping={true}
            dampingFactor={0.05}
            target={[0, 0, 0]}
          />
        </Canvas>
        
        {/* Dica de arrastar quando selecionar um representante */}
        {showDragHint && (
          <div className="drag-hint">
            <p>Arraste para mover ou segure SHIFT para rotacionar o representante</p>
          </div>
        )}
      </div>
      
      <ControlTransfer />
    </div>
  );
};

export default ConstellationField; 