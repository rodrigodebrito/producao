// Script para injetar ícones diretamente nos cards
document.addEventListener('DOMContentLoaded', function() {
  console.log('Inicializando script de correção de ícones - VERSÃO DIRETA');
  
  // Forçar carregamento do Font Awesome - múltiplas versões para garantir
  var links = [
    "https://use.fontawesome.com/releases/v5.15.4/css/all.css",
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
  ];
  
  links.forEach(function(href) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  });
  
  // Adicionar CSS inline para garantir que os ícones sejam exibidos
  var style = document.createElement('style');
  style.textContent = `
    .icon-container {
      width: 70px;
      height: 70px;
      border-radius: 50%;
      background: linear-gradient(135deg, #4A90E2, #A3D9C9);
      margin: 0 auto 25px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .icon-circle {
      font-size: 28px;
      color: white;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    .fa-spinner {
      animation: spin 2s linear infinite;
    }
  `;
  document.head.appendChild(style);
  
  // Função para substituir completamente os containers de ícones
  function replaceIcons() {
    // Primeiro, identificar todos os cards e adicionar ícones apropriados
    var cards = document.querySelectorAll('.dashboard-card');
    
    cards.forEach(function(card) {
      var cardTitle = card.querySelector('h3')?.textContent.toLowerCase() || '';
      var iconContainer = card.querySelector('.card-icon');
      
      if (iconContainer) {
        // Limpar o container e criar novo conteúdo
        iconContainer.innerHTML = '';
        
        // Determinar qual ícone usar com base no título
        var iconClass = 'fa-star'; // Padrão
        
        if (cardTitle.includes('perfil')) iconClass = 'fa-user';
        else if (cardTitle.includes('disponibilidade')) iconClass = 'fa-clock';
        else if (cardTitle.includes('agenda')) iconClass = 'fa-calendar-alt';
        else if (cardTitle.includes('diretório')) iconClass = 'fa-search';
        else if (cardTitle.includes('serviços')) iconClass = 'fa-dollar-sign';
        else if (cardTitle.includes('teste')) iconClass = 'fa-microchip';
        else if (cardTitle.includes('simplificada')) iconClass = 'fa-calendar-check';
        
        // Criar ícone com as classes diretamente
        var iconElement = document.createElement('i');
        iconElement.className = 'fas ' + iconClass + ' icon-circle';
        iconContainer.appendChild(iconElement);
        
        console.log('Ícone injetado para:', cardTitle, iconClass);
      } else {
        console.log('Container de ícone não encontrado para:', cardTitle);
      }
    });
    
    // Se não encontrar ícones por essa abordagem, tentar injetar diretamente
    if (cards.length === 0) {
      console.log('Nenhum card encontrado, tentando abordagem direta');
      
      // Encontrar elementos que deveriam ter ícones pelos textos específicos
      var elements = document.querySelectorAll('h3');
      elements.forEach(function(el) {
        var text = el.textContent.trim();
        var parent = el.parentElement;
        
        // Procurar por um texto específico e inserir o ícone antes dele
        if (text === 'Perfil Profissional') {
          injectIconBefore(el, 'fa-user');
        } else if (text === 'Minha Disponibilidade') {
          injectIconBefore(el, 'fa-clock');
        } else if (text === 'Agenda') {
          injectIconBefore(el, 'fa-calendar-alt');
        } else if (text === 'Diretório de Terapeutas') {
          injectIconBefore(el, 'fa-search');
        } else if (text === 'Serviços e Valores') {
          injectIconBefore(el, 'fa-dollar-sign');
        } else if (text === 'Disponibilidade Simplificada') {
          injectIconBefore(el, 'fa-calendar-check');
        } else if (text === 'Sessão de Teste') {
          injectIconBefore(el, 'fa-microchip');
        }
      });
    }
  }
  
  // Função para injetar um ícone antes de um elemento
  function injectIconBefore(element, iconClass) {
    var container = document.createElement('div');
    container.className = 'icon-container';
    
    var icon = document.createElement('i');
    icon.className = 'fas ' + iconClass + ' icon-circle';
    
    container.appendChild(icon);
    
    // Inserir antes do elemento
    if (element.parentNode) {
      var parent = element.parentNode;
      parent.insertBefore(container, element);
      console.log('Ícone injetado antes de:', element.textContent);
    }
  }
  
  // Executar inicialmente e depois periodicamente
  replaceIcons();
  
  // Tentar várias vezes nos primeiros segundos (quando a página está carregando)
  setTimeout(replaceIcons, 500);
  setTimeout(replaceIcons, 1000);
  setTimeout(replaceIcons, 2000);
  
  // Continuar verificando periodicamente
  setInterval(replaceIcons, 5000);
  
  console.log('Script de correção de ícones inicializado');
}); 