import './index.css';
import './styles/custom.css'; // Importando estilos personalizados
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { BrowserRouter } from 'react-router-dom';

// Importar o serviço de IA híbrida
import hybridAIService from './services/hybridAI.service';

// Disponibilizar o serviço globalmente para fácil acesso
// DESATIVADO: Serviço HybridAI comentado para evitar inicialização
// window.hybridAIService = hybridAIService;

// DESATIVADO: Inicialização do HybridAI comentada conforme solicitado
/*
// Inicializar o serviço (assíncrono)
hybridAIService.initService().then(success => {
  console.log('HybridAI: Serviço inicializado com sucesso =', success);
  
  // Desabilitar o reinício automático por padrão para evitar loops de erro
  hybridAIService.toggleAutoRestart(false);
}).catch(error => {
  console.error('Erro ao inicializar HybridAI:', error);
});
*/

// Adicionando flag para informar que o HybridAI está desativado
window.__HYBRID_AI_ACTIVE = false;
window.__HYBRID_AI_DISABLED = true;
window.__HYBRID_AI_FORCE_DISABLED = true; // Flag adicional para garantir total desativação
console.log('⛔⛔⛔ HybridAI: Serviço TOTALMENTE DESATIVADO conforme solicitado na versão 06bcfc6');
console.log('⛔⛔⛔ HybridAI: Para ativar novamente, altere as flags no index.js');

// Também desabilitar versão global para impedir qualquer tentativa de inicialização
if (typeof window !== 'undefined') {
  window.HybridAIService = null;
  window.hybridAIService = null;
}

// Configurar default para toasts
toast.configure = () => {};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <ToastContainer
        position="bottom-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
        limit={5}
      />
    </BrowserRouter>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals(); 