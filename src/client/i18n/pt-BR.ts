import type { en } from './en';

/**
 * Brazilian Portuguese. Typed against `en`, so a missing key is a compile
 * error. Product nouns (NexBot, Dot, Space, Slack, Composio, Markdown, MCP)
 * stay untranslated.
 */
export const ptBR: Record<keyof typeof en, string> = {
  // Shared
  'common.save': 'Salvar',
  'common.saving': 'Salvando…',
  'common.cancel': 'Cancelar',
  'common.retry': 'Tentar de novo',
  'common.dismiss': 'Dispensar',
  'common.done': 'Pronto',
  'common.refresh': 'Atualizar',
  'common.end': 'Encerrar',
  'common.resume': 'Retomar',
  'common.pause': 'Pausar',
  'common.noPages': 'Nenhuma página ainda',

  // Unlock screen
  'unlock.title': 'Seu cantinho só seu.',
  'unlock.instructions': 'Informe o token de acesso configurado no servidor.',
  'unlock.rejected': 'O token de acesso não foi aceito.',
  'unlock.accessToken': 'Token de acesso',
  'unlock.submit': 'Desbloquear o NexBot',
  'unlock.storageNote': 'O token fica no session storage desta aba.',

  // App shell
  'app.leaveDraftConfirm': 'Sair da página com alterações não salvas?',
  'app.connectFailed': 'Não foi possível conectar ao servidor.',
  'app.saveFailed': 'Não foi possível salvar.',
  'app.newThought': 'Uma ideia nova',
  'app.createConversationFailed': 'Não foi possível criar a conversa.',
  'app.loading': 'Procurando seus Dots…',
  'app.editSpecialist': 'Editar especialista',
  'app.setupSidebar':
    'Configure o chat de texto para iniciar uma conversa contínua.',
  'app.setupCardTitle': 'Conecte seu Dot',
  'app.setupCardBody':
    'Conecte seu modelo e o serviço de conversa em Configurações para começar a conversar. Suas preferências de Spaces e Dots já estão prontas.',
  'app.telemetryLead':
    'Metadados de configuração e uso são coletados por padrão.',
  'app.telemetryLink': 'Detalhes de rastreamento e como desativar',
  'app.setupGuideLink': 'Abrir o guia de instalação',
  'app.setupDetails': 'Detalhes da configuração',
  'app.yourWorkspace': 'SEU ESPAÇO DE TRABALHO',

  // Navigation
  'nav.workspaceNavigation': 'Navegação do workspace',
  'nav.home': 'Início do NexBot',
  'nav.expandSidebar': 'Expandir a barra lateral',
  'nav.collapseSidebar': 'Recolher a barra lateral',
  'nav.newChat': 'Nova conversa',
  'nav.openSpaces': 'Abrir Spaces',
  'nav.openActivity': 'Abrir atividade',
  'nav.openSettings': 'Abrir configurações',
  'nav.openNavigation': 'Abrir navegação',
  'nav.closeNavigation': 'Fechar navegação',
  'nav.dotsHeading': 'DOTS',
  'nav.spacesHeading': 'SPACES',
  'nav.createDot': 'Criar Dot',
  'nav.dots': 'Dots',
  'nav.editDotSettings': 'Editar as configurações de {name}',
  'nav.createSpace': 'Criar Space',
  'nav.spaces': 'Spaces',
  'nav.scheduledActivity': 'Agendamentos e atividade',
  'nav.memories': 'Memórias',
  'nav.settingsSetup': 'Configurações e instalação',
  'nav.makeItYourOwn': 'Faça do seu jeito',
  'nav.versionLabel': 'MODELO OPEN SOURCE',
  'nav.showNavigation': 'Mostrar navegação',
  'nav.hideNavigation': 'Ocultar navegação',
  'nav.activity': 'Atividade',
  'nav.pages': 'Páginas',

  // Top bar
  'topbar.selfHosted': 'AUTO-HOSPEDADO',
  'topbar.setupRequired': 'CONFIGURAÇÃO PENDENTE',
  'topbar.resumeAllDots': 'Retomar todos os Dots',
  'topbar.pauseAllDots': 'Pausar todos os Dots',
  'topbar.hideComputer': 'Ocultar o computador',
  'topbar.showComputer': 'Mostrar o computador',
  'topbar.dismissError': 'Dispensar o erro',
  'topbar.pausedNotice':
    'Todos os Dots estão pausados. O processamento ativo para e as tarefas agendadas aguardam.',

  // Composer
  'composer.startConversation': 'Iniciar uma conversa',
  'composer.messageDot': 'Mensagem para {name}…',
  'composer.firstAfterSetup':
    'Sua primeira conversa começa depois da configuração.',
  'composer.textAndCalls': 'Texto e chamadas, uma conversa contínua',
  'composer.startConversationSubmit': 'Iniciar conversa',
  'composer.starterThink': 'Me ajude a pensar nisso',
  'composer.starterResearch': 'Pesquisar uma página pública',
  'composer.starterPlan': 'Montar um plano que eu consiga seguir',

  // Chat
  'chat.contextLoadFailed':
    'Não foi possível carregar o contexto da conversa. Tente de novo antes de enviar sua mensagem.',
  'chat.connectFailed': 'Não foi possível conectar a conversa.',
  'chat.noResponse':
    'O turno atual não retornou resposta. Verifique a conexão com o runtime e tente de novo.',
  'chat.turnFailed': 'O turno falhou. Sua conversa continua salva.',
  'chat.statusPaused': 'Pausado',
  'chat.statusThinking': 'Pensando…',
  'chat.statusHere': 'Aqui com você',
  'chat.statusConnecting': 'Conectando à sua conversa…',
  'chat.saveAsPage': 'Salvar a conversa como página',
  'chat.pageTitlePrompt': 'Título da página',
  'chat.saveConversationFailed': 'Não foi possível salvar a conversa.',
  'chat.scheduleTask': 'Agendar uma tarefa nesta conversa',
  'chat.startCall': 'Iniciar chamada de voz',
  'chat.endCall': 'Encerrar chamada de voz',
  'chat.talkWithDot': 'Converse com seu Dot',
  'chat.voiceSetup': 'A voz precisa de VOICE_API_KEY e VOICE_MODEL',
  'chat.workingOn': 'Trabalhando em',
  'chat.welcomeEyebrow': 'UM ESPAÇO PARA PENSAR',
  'chat.welcomeTitle': 'O que você tem em mente?',
  'chat.welcomeBody': 'Sua conversa fica com este Dot, em texto e em chamadas.',
  'chat.dotThinking': '{name} está pensando',
  'chat.retryContext': 'Tentar o contexto de novo',
  'chat.reconnect': 'Reconectar',
  'chat.sourceUrl': 'URL da página de origem',
  'chat.removeSource': 'Remover a origem',
  'chat.addSource': 'Adicionar link de página de origem',
  'chat.messageDot': 'Mensagem para o seu Dot',
  'chat.stopResponse': 'Parar resposta',
  'chat.sendMessage': 'Enviar mensagem',
  'chat.voiceReadyNote': 'Texto e voz, uma conversa só.',
  'chat.voiceNotConfiguredNote':
    'O texto está pronto. A voz precisa de uma configuração separada no servidor.',
  'chat.scheduledLabel': 'Agendada',

  // Call receipts
  'call.failed': 'Chamada falhou',
  'call.ended': '{seconds}s · Chamada encerrada',
  'call.inProgress': 'Chamada em andamento',

  // Call view
  'callView.connecting': 'Conectando…',
  'callView.saving': 'Salvando a chamada…',
  'callView.muted': 'Microfone silenciado',
  'callView.speaking': '{name} está falando',
  'callView.thinking': 'Trabalhando nisso…',
  'callView.listening': 'Ouvindo',
  'callView.aria': 'Chamada de voz com {name}',
  'callView.expand': 'Expandir a chamada',
  'callView.minimize': 'Minimizar a chamada',
  'callView.voiceCall': 'Chamada de voz',
  'callView.duration': 'Duração da chamada',
  'callView.you': 'Você',
  'callView.placeholder': 'Fale naturalmente. Seu Dot está aqui com você.',
  'callView.enableAudio': 'Ativar o áudio da chamada',
  'callView.muteAudio': 'Silenciar o áudio da chamada',
  'callView.speaker': 'Alto-falante',
  'callView.endCall': 'Encerrar chamada de voz',
  'callView.unmute': 'Ativar o microfone',
  'callView.mute': 'Silenciar o microfone',
  'callView.unmuteShort': 'Ativar',
  'callView.muteShort': 'Silenciar',
  'callView.footer': 'Texto e voz compartilham esta conversa',

  // Computer panel
  'computer.tabBrowser': 'Navegador',
  'computer.tabFiles': 'Arquivos',
  'computer.tabTerminal': 'Terminal',
  'computer.tabActivity': 'Atividade',
  'computer.screenRefreshFailed': 'Não foi possível atualizar a tela.',
  'computer.loadFailed': 'Não foi possível carregar o computador.',
  'computer.actionFailed': 'A ação no computador falhou.',
  'computer.aria': 'Computador de {name}',
  'computer.statusUnavailable': 'Status do computador indisponível.',
  'computer.loading': 'Carregando o computador…',
  'computer.working': 'Trabalhando…',
  'computer.humanControl': 'Você está no controle',
  'computer.dotControl': 'Controle do Dot',
  'computer.setupTitle': 'Conecte um serviço de computador',
  'computer.setupBody':
    'Este Dot não tem um serviço de computador configurado. Configure a URL e o token do serviço no servidor e reinicie. Cada Dot recebe seu próprio navegador e workspace.',
  'computer.setupGuide': 'Guia de configuração do computador ↗',
  'computer.toolsLabel': 'Ferramentas do computador',
  'computer.enableBrowser': 'Ative a permissão de Navegador para usar a tela.',
  'computer.browserUrl': 'URL do navegador',
  'computer.go': 'Ir',
  'computer.browserScreen': 'Tela do navegador',
  'computer.screenAriaHuman': 'Clique em um ponto da tela do computador',
  'computer.screenAria': 'Tela do computador; assuma o controle para interagir',
  'computer.screenAlt': 'Tela ao vivo do navegador de {name}',
  'computer.refreshedAt':
    'Atualizada às {time}. A tela se atualiza enquanto este painel estiver aberto.',
  'computer.waitingScreen': 'Aguardando a tela do navegador…',
  'computer.startForScreen':
    'Inicie o computador com a permissão de Navegador para ver a tela.',
  'computer.dotHasControl': '{name} está no controle',
  'computer.returnControl': 'Devolver o controle',
  'computer.takeOver': 'Assumir o controle',
  'computer.transferring': 'Transferindo o controle…',
  'computer.keyboardControls': 'Teclado e controles precisos',
  'computer.keyboardHelp':
    'Clique na tela ou informe as coordenadas abaixo. O texto vai direto para este navegador, fora do chat. Devolva o controle quando terminar.',
  'computer.click': 'Clicar',
  'computer.typeAria': 'Texto a digitar no computador',
  'computer.typePlaceholder': 'Digite no campo em foco',
  'computer.type': 'Digitar',
  'computer.keyAria': 'Tecla a pressionar',
  'computer.pressKey': 'Pressionar tecla',
  'computer.scrollUp': 'Rolar para cima',
  'computer.scrollDown': 'Rolar para baixo',
  'computer.workspaceFiles': 'Arquivos do workspace',
  'computer.pathsHelp':
    'Os caminhos são relativos ao workspace persistente deste Dot.',
  'computer.path': 'Caminho',
  'computer.listFiles': 'Listar arquivos',
  'computer.readFile': 'Ler arquivo',
  'computer.fileContents': 'Conteúdo do arquivo',
  'computer.fileContentsAria': 'Conteúdo do arquivo a salvar',
  'computer.saveFile': 'Salvar arquivo (substituir o conteúdo)',
  'computer.enableFiles':
    'Ative a permissão de Arquivos do workspace para usar estes controles.',
  'computer.terminal': 'Terminal',
  'computer.terminalHelp':
    'Executa dentro do computador deste Dot. Os comandos param depois de 30 segundos.',
  'computer.terminalCommand': 'Comando de terminal',
  'computer.runCommand': 'Rodar comando',
  'computer.enableShell':
    'Ative a permissão de Comandos de terminal para rodar comandos.',
  'computer.output': 'Saída',
  'computer.clearOutput': 'Limpar a saída',
  'computer.recentActivity': 'Atividade recente',
  'computer.noActivity': 'Nenhuma ação no computador ainda.',
  'computer.settings': 'Configurações do computador',
  'computer.permissions': 'Permissões do computador',
  'computer.permissionsHelp':
    'Escolha a que {name} e os controles do computador podem acessar.',
  'computer.permEnabled': 'Ativar este computador',
  'computer.permBrowser': 'Navegador',
  'computer.permFiles': 'Arquivos do workspace',
  'computer.permShell': 'Comandos de terminal',
  'computer.start': 'Iniciar computador',
  'computer.stop': 'Parar computador',
  'computer.stopHelp':
    'Parar mantém os arquivos do workspace deste Dot. As sessões de navegador podem exigir login de novo.',

  // Computer tool cards
  'computerTool.navigate': 'Abrindo um site',
  'computerTool.snapshot': 'Inspecionando o navegador',
  'computerTool.read': 'Lendo a página',
  'computerTool.screenshot': 'Vendo o navegador',
  'computerTool.click': 'Clicando no navegador',
  'computerTool.type': 'Digitando no navegador',
  'computerTool.key': 'Usando o teclado',
  'computerTool.scroll': 'Rolando a página',
  'computerTool.filesWrite': 'Salvando arquivo',
  'computerTool.filesRead': 'Lendo arquivo',
  'computerTool.filesList': 'Listando arquivos',
  'computerTool.exec': 'Rodando comando de terminal',
  'computerTool.fallback': 'Usando o computador',
  'computerTool.stateInterrupted': 'Interrompido',
  'computerTool.stateFailed': 'Precisa de atenção',
  'computerTool.stateFinished': 'Concluído',
  'computerTool.stateWorking': 'Trabalhando',
  'computerTool.previewUnavailable': 'Prévia do computador indisponível.',
  'computerTool.aria': 'Computador de {name}: {action}',
  'computerTool.expand': 'Expandir o computador de {name}',
  'computerTool.terminalOutput': 'Saída do terminal do computador',
  'computerTool.currentView':
    'Computador de {name} · Visualização atual do navegador',
  'computerTool.screenAlt':
    'Visualização atual do navegador no computador de {name}',
  'computerTool.connecting': 'Conectando ao computador…',

  // Connections (MCP)
  'connections.loadFailed': 'Não foi possível carregar as conexões.',
  'connections.requestFailed': 'A solicitação falhou.',
  'connections.title': 'Conexões',
  'connections.help':
    'Dê a este Dot ferramentas de servidores MCP. Ferramentas somente leitura rodam sozinhas; qualquer outra coisa pede sua confirmação no chat antes de rodar. Os tokens ficam no servidor.',
  'connections.tokenSaved': ' · token salvo',
  'connections.refreshAria': 'Atualizar as ferramentas de {name}',
  'connections.removeAria': 'Remover {name}',
  'connections.removeConfirm': 'Remover {name} deste Dot?',
  'connections.noTools': 'Este servidor não oferece ferramentas.',
  'connections.readOnly': 'somente leitura',
  'connections.askFirst': 'Pedir antes',
  'connections.addTitle': 'Adicionar um servidor MCP',
  'connections.namePlaceholder': 'Nome, ex. GitHub',
  'connections.urlAria': 'URL do servidor MCP',
  'connections.tokenLabel': 'Token Bearer (opcional)',
  'connections.connecting': 'Conectando…',
  'connections.connect': 'Conectar',

  // Skills (per Dot)
  'skills.title': 'Habilidades',
  'skills.help':
    'Orientação reutilizável que este Dot lê no início de um turno. Uma habilidade é Markdown, não código, e só as aprovadas e ativas são usadas.',
  'skills.loadFailed': 'Não foi possível carregar as habilidades.',
  'skills.requestFailed': 'A solicitação falhou.',
  'skills.new': 'Adicionar habilidade',
  'skills.empty': 'Nenhuma habilidade ainda.',
  'skills.name': 'Nome',
  'skills.namePlaceholder': 'revisao-de-evidencias',
  'skills.nameHint':
    'Letras minúsculas, dígitos e hífens; este nome é passado ao modelo.',
  'skills.body': 'Corpo em Markdown',
  'skills.bodyPlaceholder':
    'Explique o que fazer, quando fazer e o que evitar.',
  'skills.preview': 'Prévia',
  'skills.noPreview': 'Ainda não há nada para pré-visualizar.',
  'skills.revision': 'Revisão {revision}',
  'skills.enabled': 'Ativa',
  'skills.disabled': 'Desativada',
  'skills.editAria': 'Editar {name}',
  'skills.deleteAria': 'Excluir {name}',
  'skills.deleteConfirm': 'Excluir "{name}"? Não dá para desfazer.',
  'skills.proposals': 'Sugeridas pelo Dot',
  'skills.proposalsHelp':
    'Encontradas nas suas conversas. Nada aqui é usado até você aprovar.',
  'skills.approve': 'Aprovar',
  'skills.editApprove': 'Editar e aprovar',
  'skills.reject': 'Rejeitar',
  'skills.rejectReason': 'Por que rejeitar?',
  'skills.rejectReasonPlaceholder': 'ex.: específica demais para uma conversa',
  'skills.learning': 'Aprendizado automático',
  'skills.learningToggle': 'Sugerir habilidades a partir de conversas',
  'skills.learningHelp':
    'Desativado por padrão. Quando ativado, o NexBot revisa conversas longas depois que elas terminam e sugere habilidades aqui para sua aprovação. Cada revisão consome o orçamento do seu modelo.',
  'skills.learningQuota': 'Revisões na última hora: {used} de {limit}.',
  'skills.proposalProvenance': 'Sugerida automaticamente em {date}',

  // Connected-service action card
  'connectionAction.loadFailed': 'Não foi possível carregar esta solicitação.',
  'connectionAction.checkFailed': 'Não foi possível verificar esta ação.',
  'connectionAction.runFailed': 'Não foi possível executar esta ação.',
  'connectionAction.aria': 'Aprovar ação de serviço conectado',
  'connectionAction.connectedService': 'Serviço conectado',
  'connectionAction.failed': 'Falhou',
  'connectionAction.approved': 'Aprovada',
  'connectionAction.declined': 'Recusada',
  'connectionAction.running': 'Em execução',
  'connectionAction.interrupted': 'Interrompida',
  'connectionAction.ended': 'Encerrada',
  'connectionAction.checking': 'Verificando',
  'connectionAction.needsApproval': 'Precisa da sua aprovação',
  'connectionAction.preparing': 'Preparando a ação…',
  'connectionAction.cannotRun': 'Não é possível executar',
  'connectionAction.mismatch':
    'O resultado salvo deste cartão pertence a outra solicitação de aprovação. Nada foi executado para esta.',
  'connectionAction.serviceError': 'Erro do serviço',
  'connectionAction.serviceResponse': 'Resposta do serviço',
  'connectionAction.runningBusy': 'Executando…',
  'connectionAction.continue': 'Continuar a conversa',
  'connectionAction.retryRun': 'Tentar e executar',
  'connectionAction.approveRun': 'Aprovar e executar',
  'connectionAction.decline': 'Recusar',
  'connectionAction.stillRunning': 'Esta ação ainda está rodando no servidor.',
  'connectionAction.interruptedNote':
    'Nenhum resultado foi salvo na execução anterior. Tentar de novo pode repetir a ação se o serviço já a concluiu antes da interrupção.',
  'connectionAction.approvalNote':
    'Nada roda sem a sua aprovação. Estes são os argumentos exatos.',

  // Mascot
  'mascot.alt': '{name} está {state}',
  'mascot.stateIdle': 'ocioso',
  'mascot.stateWorking': 'trabalhando',
  'mascot.statePaused': 'pausado',

  // Model settings
  'model.testing': 'Testando a conexão…',
  'model.accepted': 'O provedor aceitou esta configuração.',
  'model.testFailed': 'O teste falhou.',
  'model.testingSaving': 'Testando e salvando…',
  'model.saved': 'Salvo. As novas conversas usam este provedor.',
  'model.saveFailed': 'Não foi possível salvar.',
  'model.title': 'Provedor do modelo',
  'model.connected':
    'Conectado a {model}. A chave é guardada criptografada e não é mostrada de novo.',
  'model.choose': 'Escolha o provedor que suas conversas vão usar.',
  'model.baseUrl': 'URL base',
  'model.model': 'Modelo',
  'model.apiKey': 'Chave da API',
  'model.replaceKey': 'Informe uma nova chave para substituir',
  'model.pasteKey': 'Cole sua chave',
  'model.testConnection': 'Testar conexão',

  // Per-Dot model override
  'dotModel.title': 'Modelo deste Dot',
  'dotModel.notConfigured':
    'Nenhum provedor de modelo está configurado ainda. Defina o provedor global nas Configurações.',
  'dotModel.inherited': 'Este Dot usa o modelo do provedor global: {model}.',
  'dotModel.set': 'Este Dot usa {model}, definido só para ele.',
  'dotModel.overrideHelp':
    'Deixe os campos em branco para continuar herdando o provedor global, ou preencha-os para dar a este Dot uma URL base, um modelo e uma chave próprios.',
  'dotModel.replaceKey': 'Informe uma nova chave para substituir',
  'dotModel.pasteKey': 'Cole sua chave',
  'dotModel.testConnection': 'Testar conexão',
  'dotModel.testing': 'Testando a conexão…',
  'dotModel.accepted': 'O provedor aceitou esta configuração.',
  'dotModel.testFailed': 'O teste falhou.',
  'dotModel.testingSaving': 'Testando e salvando…',
  'dotModel.saved': 'Salvo. As novas conversas deste Dot usam este provedor.',
  'dotModel.saveFailed': 'Não foi possível salvar.',
  'dotModel.remove': 'Voltar ao provedor global',
  'dotModel.removing': 'Restaurando o provedor global…',
  'dotModel.removed': 'Este Dot volta a herdar o provedor global.',
  'dotModel.removeFailed': 'Não foi possível restaurar o provedor global.',

  // Page conversation dock
  'pageChat.saveFirst':
    'Salve ou resolva as alterações do documento antes de iniciar o chat da página.',
  'pageChat.openFailed': 'Não foi possível abrir o chat da página.',
  'pageChat.heading': 'Conversa da página',
  'pageChat.close': 'Fechar o chat da página',
  'pageChat.addSpecialist':
    'Adicione um especialista para trabalhar com este Space.',
  'pageChat.createSpecialist': 'Criar especialista',
  'pageChat.connectAssistant':
    'Conecte seu assistente para conversar sobre esta página.',
  'pageChat.setUpAssistant': 'Configurar assistente',
  'pageChat.askLabel': 'Pergunte sobre esta página',
  'pageChat.askPlaceholder': 'Pergunte sobre esta página…',
  'pageChat.specialist': 'Especialista da página',
  'pageChat.paused': 'Assistente pausado',
  'pageChat.usesSavedPage': 'Usa esta página salva',
  'pageChat.send': 'Enviar para o assistente da página',

  // Document
  'doc.statusSaving': 'Salvando…',
  'doc.statusSaved': 'Todas as alterações salvas',
  'doc.statusDirty': 'Alterações não salvas',
  'doc.statusConflict': 'Alterações precisam de revisão',
  'doc.statusError': 'Não foi possível salvar',
  'doc.workspace': 'Workspace do documento',
  'doc.allPages': 'Todas as páginas',
  'doc.toggleOutline': 'Alternar o sumário da página',
  'doc.menuSaveNow': 'Salvar agora · ⌘/Ctrl S',
  'doc.menuVisualEditor': 'Editor visual',
  'doc.menuMarkdownSource': 'Fonte Markdown',
  'doc.menuMovePage': 'Mover página',
  'doc.menuNewSubpage': 'Nova subpágina',
  'doc.menuDownload': 'Baixar Markdown',
  'doc.menuOpenSource': 'Abrir a conversa de origem',
  'doc.menuDelete': 'Excluir página',
  'doc.deleteConfirm':
    'Excluir "{title}"? Isso não pode ser desfeito. As subpáginas vão para a página acima.',
  'doc.untitled': 'Sem título',
  'doc.deleteFailed': 'Não foi possível excluir a página.',
  'doc.retrySave': 'Tentar salvar de novo',
  'doc.downloadDraft': 'Baixar rascunho',
  'doc.loadLatest': 'Carregar a mais recente',
  'doc.loadLatestConfirm':
    'Carregar a página salva mais recente e substituir este rascunho? Baixe seu rascunho antes se quiser mantê-lo.',
  'doc.draftChanged':
    'Seu rascunho mudou durante o carregamento. Escolha "Carregar a mais recente" de novo para substituí-lo.',
  'doc.loadLatestFailed':
    'Não foi possível carregar a página mais recente. Seu rascunho não mudou.',
  'doc.moveUnder': 'Mover para dentro de',
  'doc.parentPage': 'Página superior',
  'doc.spaceRoot': 'Raiz do Space',
  'doc.pageTitle': 'Título da página',
  'doc.untitledPage': 'Página sem título',
  'doc.markdownSource': 'Fonte Markdown',
  'doc.pageMarkdown': 'Markdown da página',
  'doc.loadingEditor': 'Carregando o editor…',
  'doc.needsSourceMode': 'Este documento precisa do modo fonte.',
  'doc.actions': 'Ações da página',

  // Page outline
  'outline.aria': 'Páginas deste Space',
  'outline.pages': 'Páginas',
  'outline.newPage': 'Nova página no sumário',
  'outline.close': 'Fechar o sumário',

  // Page review card
  'review.restoreFailed': 'Não foi possível restaurar esta revisão.',
  'review.saveFailed': 'Não foi possível salvar o rascunho aprovado.',
  'review.aria': 'Revisar rascunho de página',
  'review.changed': 'A revisão mudou',
  'review.savedThenDeleted': 'Salva e depois excluída',
  'review.savedToSpace': 'Salva no seu Space',
  'review.checking': 'Verificando a revisão salva…',
  'review.ended': 'Revisão encerrada',
  'review.ready': 'Pronta para sua revisão',
  'review.needsNewReview': 'Precisa de uma nova revisão',
  'review.approved': 'Aprovada',
  'review.checkingShort': 'Verificando',
  'review.notSaved': 'Não salva',
  'review.youDecide': 'Você decide',
  'review.preparing': 'Preparando seu rascunho…',
  'review.conflict':
    'Esta revisão foi salva com outro rascunho. Inicie uma nova revisão para o rascunho alterado.',
  'review.retry': 'Tentar a revisão de novo',
  'review.openSavedPage': 'Abrir página salva',
  'review.openPage': 'Abrir página',
  'review.continue': 'Continuar a conversa',
  'review.approveSave': 'Aprovar e salvar',
  'review.decline': 'Recusar',
  'review.checkingNote': 'Verificando se este rascunho já foi salvo.',
  'review.noPageSaved': 'Nenhuma página foi salva.',
  'review.nothingSavedNote': 'Nada é salvo antes da sua aprovação.',
  'review.updatesExistingPage':
    'A aprovação atualiza a página existente neste Space.',

  // Result pane
  'result.brief': 'Resumo',
  'result.computer': 'Computador',
  'result.computerFor': 'Computador de {name}',
  'result.close': 'Fechar o painel de resultados',
  'result.computerForLabel': 'Computador de',
  'result.selectComputer': 'Escolher o computador do Dot',
  'result.createDot': 'Crie um Dot para dar um computador a ele.',
  'result.sampleEyebrow': 'RESUMO FICTÍCIO DE EXEMPLO',
  'result.researchEyebrow': 'RESUMO DA PESQUISA',
  'result.download': 'Baixar o resumo',
  'result.sourcesHeading': 'Fontes',
  'result.sampleNote':
    'Um exemplo do que o Dot pode fazer. As descobertas e fontes abaixo são inventadas.',
  'result.imageAlt': '[Imagem: {alt}]',
  'result.imageOmitted': '[Imagem omitida]',
  'result.sourceNotes': 'Notas de fontes',
  'result.fictionalSource': 'Fonte fictícia · o link não é real',
  'result.emptyTitle': 'Um espacinho para suas descobertas.',
  'result.emptyFailed':
    'Resolva o erro e tente de novo para gerar um resumo de pesquisa.',
  'result.emptyBody':
    'Seu resumo e suas fontes aparecem aqui depois de uma execução bem-sucedida.',

  // Space library
  'library.aria': 'Biblioteca de páginas de {name}',
  'library.eyebrow': 'SPACE',
  'library.newPage': 'Nova página',
  'library.search': 'Buscar páginas',
  'library.sortLabel': 'Ordenar páginas',
  'library.sortRecent': 'Editadas recentemente',
  'library.sortName': 'Nome A–Z',
  'library.viewLabel': 'Visualização da biblioteca',
  'library.gridView': 'Visualização em grade',
  'library.listView': 'Visualização em lista',
  'library.searchResults': 'Resultados da busca',
  'library.allPages': 'Todas as páginas',
  'library.pageCountOne': '1 página',
  'library.pageCountOther': '{count} páginas',
  'library.emptyPage': 'Uma página vazia, pronta para escrever.',
  'library.edited': 'Editada em {date}',
  'library.noMatches': 'Nenhuma página encontrada',
  'library.noPages': 'Nenhuma página ainda',
  'library.tryDifferent': 'Tente outro título ou outra frase.',
  'library.createFirst':
    'Crie sua primeira página para começar a organizar este Space.',
  'library.codeBlock': 'Bloco de código',

  // Space navigation
  'spaceNav.loadFailed': 'Não foi possível carregar as páginas.',
  'spaceNav.collapse': 'Recolher {name}',
  'spaceNav.expand': 'Expandir {name}',

  // Space workspace
  'space.createFailed': 'Não foi possível criar a página.',
  'space.documents': 'Documentos do Space',
  'space.pageNotFound': 'Página não encontrada',
  'space.loadingPage': 'Carregando a página…',
  'space.backToAllPages': 'Voltar para todas as páginas',

  // Task controls
  'task.pause': 'Pausar tarefa',
  'task.retryAfterReview': 'Tentar de novo após revisar',
  'task.retry': 'Tentar a tarefa de novo',
  'task.resume': 'Retomar tarefa',
  'task.runAgain': 'Rodar de novo',
  'task.pauseSchedule': 'Pausar agendamento',
  'task.editSchedule': 'Editar agendamento',
  'task.setSchedule': 'Definir um agendamento',
  'task.justNow': 'Agora mesmo',
  'task.minutesAgo': 'há {count} min',
  'task.hoursAgo': 'há {count} h',
  'task.repeatsMinutes': 'Repete a cada {count} min · ',
  'task.repeatsHours': 'Repete a cada {count} h · ',
  'task.statusScheduled': 'Agendada',
  'task.statusCompleted': 'Concluída',
  'task.statusRunning': 'Em execução',
  'task.statusQueued': 'Na fila',
  'task.statusPaused': 'Pausada',
  'task.statusFailed': 'Falhou',
  'task.statusInterrupted': 'Interrompida',
  'task.statusCancelled': 'Cancelada',

  // Tasks and memories views
  'tasks.title': 'Um pouco de continuidade.',
  'tasks.subtitle': 'Turnos agendados rodam no servidor, na conversa original.',
  'tasks.searchLabel': 'Buscar tarefas',
  'tasks.searchPlaceholder': 'Encontrar uma tarefa…',
  'tasks.emptyTitle': 'Deixe uma ideia voltar depois.',
  'tasks.emptyBody':
    'Abra uma conversa e use o botão de relógio para agendar uma tarefa no servidor.',
  'tasks.intervalPrompt':
    'Intervalo de repetição em minutos (0 remove o agendamento)',
  'tasks.intervalInvalid': 'Informe um número de minutos válido.',
  'tasks.savedRunsOne': '1 execução salva',
  'tasks.savedRunsOther': '{count} execuções salvas',
  'memories.subtitle':
    'Preferências que você escolhe compartilhar com seus Dots.',
  'memories.add': 'Adicionar memória',
  'memories.available': 'Disponível para os Dots permitidos',
  'memories.disabled': 'Uso de memória desativado',
  'memories.edit': 'Editar memória',
  'memories.delete': 'Excluir memória',
  'memories.emptyTitle': 'Um pouco de contexto ajuda muito.',
  'memories.emptyBody':
    'Adicione uma preferência como “Quero resumos de pesquisa curtos”. Você pode mudar ou remover quando quiser.',

  // Thread list
  'threads.heading': 'CONVERSAS RECENTES',
  'threads.new': 'Nova conversa',
  'threads.syncUnavailable':
    'Sincronização de conversas indisponível. Verifique a conexão com o runtime.',
  'threads.empty': 'Sua primeira conversa vai ficar aqui.',
  'threads.loadMore': 'Carregar mais conversas',

  // Workspace dialog
  'dialog.titleSpace': 'Um Space para alguma coisa.',
  'dialog.titleDotNew': 'Conheça seu próximo especialista.',
  'dialog.titleDotEdit': 'Deixe este Dot com a sua cara.',
  'dialog.titleSettings': 'Seu workspace, suas regras.',
  'dialog.titleMemory': 'Algo para lembrar.',
  'dialog.titleSchedule': 'Deixe seu Dot contar o tempo.',
  'dialog.close': 'Fechar a janela',
  'dialog.eyebrow': 'MODELO NEXBOT',
  'dialog.saveFailed':
    'Não foi possível salvar. Veja o erro do workspace e tente de novo.',
  'dialog.name': 'Nome',
  'dialog.roleInstructions': 'Instruções do papel',
  'dialog.whatBelongs': 'O que entra aqui?',
  'dialog.preferenceOrContext': 'Preferência ou contexto',
  'dialog.taskToRevisit': 'Tarefa para retomar',
  'dialog.instructionsPlaceholder':
    'Você é um parceiro de pesquisa atento. Compare evidências e deixe claro onde há incerteza.',
  'dialog.spaceAccess': 'Acesso aos Spaces',
  'dialog.spaceAccessHelp': 'Escolha onde este Dot pode ler e editar páginas.',
  'dialog.defaultSpaceLabel': 'Destino padrão das páginas salvas',
  'dialog.chooseSpace': 'Escolha um Space',
  'dialog.publicResearch': 'Pesquisa em páginas públicas',
  'dialog.publicResearchHelp':
    'Permite a ferramenta de navegação somente leitura no servidor. As configurações globais sempre têm prioridade.',
  'dialog.useMemories': 'Usar memórias salvas',
  'dialog.useMemoriesHelp':
    'Inclui suas preferências nos novos turnos. Mudar a permissão interrompe o trabalho em andamento.',
  'dialog.connectedApps': 'Apps conectados',
  'dialog.connectedAppsHelp':
    'Permite o acesso aos apps do proprietário pelo Composio. As configurações globais sempre têm prioridade.',
  'dialog.toolkitSlugs': 'Slugs de toolkits',
  'dialog.toolkitSlugsHelp':
    'Slugs de toolkits do Composio separados por vírgula (opcional). Deixe em branco para o Dot buscar todos os toolkits disponíveis.',
  'dialog.localSkills': 'Habilidades locais',
  'dialog.skillSetId': 'ID do conjunto de habilidades (opcional)',
  'dialog.skillsHelp':
    'As habilidades ficam no banco local deste workspace, por Dot, e nunca são enviadas para um serviço hospedado. Deixe em branco para manter este Dot fora da entrega de habilidades. Este painel controla a entrega; gerencie as próprias habilidades na seção Habilidades abaixo.',
  'dialog.deliverSkills': 'Entregar habilidades locais',
  'dialog.deliverSkillsHelp':
    'Expõe as habilidades locais ativas deste Dot no início de cada turno. Desligar isso interrompe o carregamento das habilidades na hora.',
  'dialog.repeatAfter': 'Repetir depois de cada execução bem-sucedida',
  'dialog.everyMinute': 'A cada minuto (teste)',
  'dialog.everyHour': 'A cada hora',
  'dialog.everyDay': 'Todo dia',
  'dialog.everyWeek': 'Toda semana',
  'dialog.scheduleHelp':
    'Roda no servidor, nesta mesma conversa, mesmo com a aba fechada. Execuções que falham ou são interrompidas aguardam uma nova tentativa manual. Revise o trabalho concluído antes de tentar de novo uma execução interrompida.',
  'dialog.appearance': 'Aparência',
  'dialog.themeSystem': 'Sistema',
  'dialog.themeLight': 'Claro',
  'dialog.themeDark': 'Escuro',
  'dialog.appearanceHelp':
    'Salvo neste navegador. O sistema segue o seu dispositivo.',
  'dialog.language': 'Idioma',
  'dialog.languageSystem': 'Sistema',
  'dialog.languageEnglish': 'English',
  'dialog.languagePortuguese': 'Português (Brasil)',
  'dialog.languageHelp':
    'Salvo neste navegador. O sistema segue o idioma do seu dispositivo.',
  'dialog.serviceSetup': 'Configuração do serviço',
  'dialog.setupMissing': 'Ainda falta um pouco de configuração no servidor.',
  'dialog.setupPresent':
    'A configuração de texto está presente. Uma conversa bem-sucedida confirma a conectividade.',
  'dialog.slackVoice': 'Slack: {slack}. Voz: {voice}.',
  'dialog.voicePresent': 'configuração presente',
  'dialog.voiceMissing': 'precisa de VOICE_API_KEY e VOICE_MODEL',
  'dialog.setupGuide': 'Guia de instalação do modelo ↗',
  'dialog.memoryHelp':
    'Memórias são preferências explícitas, não aprendizado automático. Evite segredos; memórias ativas vão para o provedor do seu modelo.',

  // Editor
  'editor.placeholder': 'Comece a escrever, ou digite / para blocos…',
  'editor.contentAria': 'Conteúdo da página',
  'editor.pasteUnsupported':
    'Imagens e conteúdo incorporado não são suportados aqui. Use a fonte Markdown para manter a marcação original.',
  'editor.toolbar': 'Formatação de texto',
  'editor.boldTitle': 'Negrito (⌘/Ctrl B)',
  'editor.bold': 'Negrito',
  'editor.italicTitle': 'Itálico (⌘/Ctrl I)',
  'editor.italic': 'Itálico',
  'editor.bulletList': 'Lista com marcadores',
  'editor.numberedList': 'Lista numerada',
  'editor.quote': 'Citação',
  'editor.codeBlock': 'Bloco de código',
  'editor.addLink': 'Adicionar link',
  'editor.linkPrompt': 'URL do link (https:// ou um link interno de página)',
  'editor.linkInvalid':
    'Use uma URL http(s) pública ou um link interno de página.',
  'editor.undo': 'Desfazer',
  'editor.redo': 'Refazer',
  'editor.hintBefore': 'Digite ',
  'editor.hintAfter': ' para blocos · ⌘/Ctrl + S para salvar',

  // Slash command menu
  'slash.text': 'Texto',
  'slash.textDescription': 'Comece com um parágrafo simples',
  'slash.heading': 'Título {level}',
  'slash.heading1Description': 'Um título de seção grande',
  'slash.heading2Description': 'Um título de seção médio',
  'slash.heading3Description': 'Um título de seção pequeno',
  'slash.bulletList': 'Lista com marcadores',
  'slash.bulletListDescription': 'Uma lista simples sem ordem',
  'slash.numberedList': 'Lista numerada',
  'slash.numberedListDescription': 'Uma sequência ordenada',
  'slash.checklist': 'Lista de tarefas',
  'slash.checklistDescription': 'Acompanhe o que fazer',
  'slash.quote': 'Citação',
  'slash.quoteDescription': 'Destaque um trecho',
  'slash.code': 'Código',
  'slash.codeDescription': 'Um bloco de código',
  'slash.divider': 'Divisor',
  'slash.dividerDescription': 'Separe seções',
  'slash.table': 'Tabela',
  'slash.tableDescription': 'Três colunas com cabeçalho',
  'slash.label': 'INSERIR BLOCO',
  'slash.empty': 'Nenhum bloco encontrado',
  'slash.aria': 'Inserir bloco',

  // Autosave
  'autosave.conflict':
    'Esta página mudou em outro lugar. Seu rascunho está seguro. Copie-o antes de carregar a versão mais recente.',
  'autosave.invalid':
    'Use um título de até 160 caracteres e um documento de até 100.000 caracteres. Seu rascunho continua aqui.',
  'autosave.timeout':
    'O salvamento demorou demais. Seu rascunho está seguro; tente de novo quando estiver conectado.',
  'autosave.newerRevision':
    'Existe uma revisão mais nova. Seu rascunho foi preservado.',
  'autosave.saveFailed': 'Não foi possível salvar. Seu rascunho está seguro.',

  // Markdown inspection
  'markdown.extended':
    'Este documento tem Markdown estendido. O modo fonte o preserva exatamente.',
  'markdown.unsupported':
    'Este documento tem imagens, HTML ou formatação que precisa do modo fonte Markdown. Nada foi alterado.',
  'markdown.roundTrip':
    'Parte da formatação não sobrevive a uma ida e volta segura. O modo fonte mantém o documento original intacto.',
  'markdown.needsSource':
    'Este Markdown precisa do modo fonte para preservar seu conteúdo.',

  // Page context
  'pageContext.notLoaded':
    'O contexto da conversa ainda não carregou. Tente de novo antes de enviar.',

  // Voice
  'voice.receiptFailed':
    'A chamada terminou, mas o comprovante não pôde ser salvo.',
  'voice.controlLost': 'A conexão de controle da chamada foi perdida.',
  'voice.audioBlocked':
    'A reprodução de áudio foi bloqueada. Verifique as permissões de áudio do navegador.',
  'voice.dropped': 'A conexão de voz caiu.',
  'voice.providerError':
    'O provedor de voz reportou um erro de sessão. Encerre a chamada e tente de novo.',
  'voice.connectFailed': 'Não foi possível conectar a chamada.',

  // API transport
  'api.unreadable': 'O servidor retornou uma resposta ilegível.',
  'api.requestFailed': 'A solicitação falhou ({status}).',
};
