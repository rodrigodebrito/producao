// Script para garantir que os ícones do Font Awesome funcionem
document.addEventListener('DOMContentLoaded', function() {
  console.log('Inicializando script de correção de ícones');
  
  // Forçar carregamento do Font Awesome
  if (!window.FontAwesomeConfig) {
    console.log('FontAwesome não detectado, carregando versão local');
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css';
    document.head.appendChild(link);
  }
  
  // Verificar e corrigir ícones periodicamente
  function checkIcons() {
    // Cards do dashboard
    document.querySelectorAll('.card-icon i:not(.fa):not(.fas):not(.far):not(.fab)').forEach(function(icon) {
      // Substituir com ícones apropriados baseado no texto ou contexto
      var parentText = icon.closest('.dashboard-card')?.textContent.toLowerCase() || '';
      var newClass = 'fas ';
      
      if (parentText.includes('perfil')) newClass += 'fa-user';
      else if (parentText.includes('disponibilidade')) newClass += 'fa-clock';
      else if (parentText.includes('agenda')) newClass += 'fa-calendar-alt';
      else if (parentText.includes('diretório')) newClass += 'fa-search';
      else if (parentText.includes('serviços')) newClass += 'fa-dollar-sign';
      else if (parentText.includes('teste')) newClass += 'fa-microchip';
      else newClass += 'fa-star'; // Ícone genérico
      
      console.log('Corrigindo ícone:', icon, 'Nova classe:', newClass);
      icon.className = newClass;
    });
    
    // Ícones nos botões e cabeçalhos
    var iconMappings = {
      'log-out': 'fa-sign-out-alt',
      'loader': 'fa-spinner fa-spin',
      'alert-circle': 'fa-exclamation-circle',
      'alert-triangle': 'fa-exclamation-triangle',
      'edit-2': 'fa-edit',
      'list': 'fa-list',
      'zap': 'fa-bolt',
      'bar-chart-2': 'fa-chart-bar',
      'video': 'fa-video',
      'users': 'fa-users',
      'percent': 'fa-percentage',
      'grid': 'fa-th-large',
      'gift': 'fa-gift'
    };
    
    // Corrigir todos os [data-feather] remanescentes
    document.querySelectorAll('[data-feather]').forEach(function(icon) {
      var iconType = icon.getAttribute('data-feather');
      var faClass = iconMappings[iconType] || 'fa-star';
      icon.removeAttribute('data-feather');
      icon.className = 'fas ' + faClass;
    });
    
    // Corrigir ícones sem classe
    document.querySelectorAll('i:not([class])').forEach(function(icon) {
      icon.className = 'fas fa-star';
    });
  }
  
  // Executar imediatamente e depois a cada segundo
  checkIcons();
  setInterval(checkIcons, 1000);
}); 