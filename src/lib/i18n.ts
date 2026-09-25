export type AppLocale = "pt-BR" | "en-US" | "es-ES";

type Dictionary = Record<string, string>;

const EN: Dictionary = {
  "E-mail":"Mail","Calendário":"Calendar","Pessoas":"People","Tarefas":"Tasks","Notas":"Notes","Regras":"Rules","Configurações":"Settings",
  "Caixa de entrada":"Inbox","Rascunhos":"Drafts","Enviados":"Sent","Arquivados":"Archive","Spam":"Spam","Lixeira":"Trash",
  "Novo e-mail":"New mail","Nova mensagem":"New message","Nova tarefa":"New task","Novo evento":"New event","Novo contato":"New contact","Nova regra":"New rule",
  "Pesquisar e-mails, pessoas, eventos...":"Search mail, people, events...","Pesquisar":"Search","Sincronizar":"Sync","Todas":"All","Não lidas":"Unread","Sinalizadas":"Flagged","Fixadas":"Pinned","Anexos":"Attachments",
  "Responder":"Reply","Responder a todos":"Reply all","Encaminhar":"Forward","Redirecionar":"Redirect","Reenviar":"Resend","Arquivar":"Archive","Excluir":"Delete","Imprimir":"Print",
  "Criar tarefa":"Create task","Criar evento":"Create event","Salvar EML":"Save EML","Importar":"Import","Exportar":"Export","Salvar":"Save","Cancelar":"Cancel","Fechar":"Close",
  "Hoje":"Today","Ontem":"Yesterday","Esta semana":"This week","Mais recentes":"Newest","Mais antigas":"Oldest","Remetente":"Sender","Assunto":"Subject","Status":"Status",
  "Selecione uma mensagem":"Select a message","Leia, responda e organize sem sair da mesma tela.":"Read, reply and organize without leaving this screen.",
  "MENSAGEM":"MESSAGE","FAVORITOS":"FAVORITES","PASTAS":"FOLDERS","CATEGORIAS":"CATEGORIES","PESQUISAS SALVAS":"SAVED SEARCHES","AUTOMAÇÕES":"AUTOMATIONS",
  "Prioridade baixa":"Low priority","Prioridade normal":"Normal priority","Prioridade alta":"High priority","Importante":"Important","Silenciar":"Mute","Liberar conversa":"Unmute conversation","Ignorar conversa":"Ignore conversation",
  "Mover para...":"Move to...","Copiar para...":"Copy to...","Organizar":"Organize","Cabeçalhos":"Headers","Fonte":"Source","Nova janela":"New window","Bloquear remetente":"Block sender","Confiar remetente":"Trust sender",
  "Dia":"Day","3 dias":"3 days","Semana":"Week","Semana útil":"Work week","Mês":"Month","Agenda":"Agenda","Lado a lado":"Side by side","Feriados":"Holidays","Calendário ICS":"ICS Calendar",
  "Novo calendário":"New calendar","Dia inteiro":"All day","Evento privado":"Private event","Título":"Title","Início":"Start","Fim":"End","Local":"Location","Descrição":"Description","Participantes obrigatórios":"Required attendees","Participantes opcionais":"Optional attendees",
  "Salas e recursos":"Rooms and resources","Recorrência":"Recurrence","Não repetir":"Do not repeat","Diária":"Daily","Semanal":"Weekly","Mensal":"Monthly","Anual":"Yearly","Repetir até":"Repeat until","Fuso horário":"Time zone",
  "Mostrar como":"Show as","Ocupado":"Busy","Provisório":"Tentative","Livre":"Free","Lembrete":"Reminder","Aceitar":"Accept","Recusar":"Decline","Sem resposta":"No response","Aceito":"Accepted","Recusado":"Declined",
  "Respostas dos participantes":"Attendee responses","Manter convite na caixa de entrada após responder":"Keep invitation in inbox after responding","Enviar/atualizar convite":"Send/update invitation","Cancelar reunião":"Cancel meeting",
  "Contatos":"Contacts","Novo grupo":"New group","Todos os grupos":"All groups","Mesclar duplicados":"Merge duplicates","Favorito":"Favorite","Nome":"First name","Sobrenome":"Last name","Nome de exibição":"Display name","Apelido":"Nickname","Empresa":"Company","Cargo":"Job title",
  "E-mails":"Emails","Telefones":"Phones","Endereços":"Addresses","Datas importantes":"Important dates","Grupos / listas":"Groups / lists","Observações":"Notes","Origem":"Source","compartilhado":"shared","compartilhada":"shared",
  "Importar ICS":"Import ICS","Exportar ICS":"Export ICS","Importar contatos":"Import contacts","Exportar backup":"Export backup","Restaurar backup":"Restore backup","Limpar apenas cache":"Clear cache only",
  "ABERTAS":"OPEN","CONCLUÍDAS":"COMPLETED","Atrasadas":"Overdue","Próximas":"Upcoming","Meu dia":"My day","Lista":"List","Prioridade":"Priority","Baixa":"Low","Normal":"Normal","Alta":"High","Vencimento":"Due date",
  "Adicionar tarefa para hoje":"Add a task for today","Nenhuma tarefa nesta visualização.":"No tasks in this view.","Reabrir":"Reopen","Concluir":"Complete",
  "Nova nota":"New note","Fixar":"Pin","Desafixar":"Unpin","Cor":"Color","Nenhuma nota ainda":"No notes yet",
  "Executar regras agora":"Run rules now","Executando...":"Running...","Regra ativa":"Rule enabled","Parar após esta regra":"Stop after this rule","Campo":"Field","Operador":"Operator","Valor":"Value","Ação":"Action",
  "Contém":"Contains","É exatamente":"Equals","Maior que":"Greater than","Menor que":"Less than","Mover para pasta":"Move to folder","Copiar para pasta":"Copy to folder","Adicionar categoria":"Add category","Encaminhar para":"Forward to",
  "Sobre o Seven Mail":"About Seven Mail","Identidade e informações do aplicativo.":"App identity and information.","Cliente desktop local-first":"Local-first desktop client",
  "Idioma, data e hora":"Language, date and time","Idioma":"Language","Formato de data":"Date format","Formato de hora":"Time format","Primeiro dia":"First day","Fuso principal":"Primary time zone","Fusos secundários":"Secondary time zones",
  "Horário de trabalho":"Working hours","Local de trabalho":"Work location","Aparência":"Appearance","Tema e densidade da interface.":"Theme and interface density.","Sistema":"System","Claro":"Light","Escuro":"Dark","Lista compacta":"Compact list","Linhas de prévia":"Preview lines",
  "Painel de leitura":"Reading pane","À direita":"Right","Abaixo":"Bottom","Desativado":"Off","Marcar como lida":"Mark as read","Imediatamente":"Immediately",
  "Envio":"Sending","Desfazer envio":"Undo send","Confirmar antes de enviar":"Confirm before sending","Escrita e idioma":"Writing and language","Idioma de composição":"Compose language","Autocorreção conservadora":"Conservative autocorrect","Capitalização automática":"Automatic capitalization","Dicionário personalizado":"Custom dictionary",
  "Sincronização e notificações":"Sync and notifications","Intervalo":"Interval","Retenção local":"Local retention","Sincronizações simultâneas":"Concurrent syncs","Economia de bateria":"Battery saver","Economia de memória":"Memory saver","Horário silencioso":"Quiet hours",
  "Recusar automaticamente convites que conflitam com a agenda":"Automatically decline invitations that conflict with the calendar",
  "Ausência e encaminhamento":"Away and forwarding","Resposta automática":"Automatic reply","Encaminhamento automático":"Automatic forwarding","Dados locais":"Local data","Dados":"Data","Cache":"Cache","Fila":"Queue",
  "Contas":"Accounts","Adicionar conta":"Add account","Conta padrão":"Default account","Testar conexão":"Test connection","Remover conta":"Remove account","Senha":"Password","Servidor":"Server","Porta":"Port",
  "Assinaturas":"Signatures","Nova assinatura":"New signature","Usar como padrão nesta conta":"Use as default for this account","Conteúdo":"Content",
  "Perfis":"Profiles","Extensões":"Extensions","Ativar":"Enable","Desativar":"Disable","Permissões":"Permissions",
  "Nova pasta":"New folder","Renomear":"Rename","Compartilhar":"Share","Compartilhado":"Shared","Somente leitura":"Read only","Editar":"Edit","Delegar":"Delegate",
  "Carregando sua caixa e espaço de trabalho":"Loading your mailbox and workspace","Preparando seu espaço":"Preparing your workspace","Tudo pronto":"All set",
  "Carregando...":"Loading...","Nenhum resultado":"No results","Nenhum contato ainda":"No contacts yet","Nenhum evento neste dia.":"No events on this day.","Agenda livre":"Free schedule","Agenda vazia":"Empty agenda",
  "Sim":"Yes","Não":"No","De":"From","Para":"To","Cc":"Cc","Cco":"Bcc","Corpo":"Body","Anexo":"Attachment","Anexar":"Attach","Enviar":"Send","Programar envio":"Schedule send",
};

const ES: Dictionary = {
  "E-mail":"Correo","Calendário":"Calendario","Pessoas":"Personas","Tarefas":"Tareas","Notas":"Notas","Regras":"Reglas","Configurações":"Configuración",
  "Caixa de entrada":"Bandeja de entrada","Rascunhos":"Borradores","Enviados":"Enviados","Arquivados":"Archivados","Spam":"Spam","Lixeira":"Papelera",
  "Novo e-mail":"Nuevo correo","Nova mensagem":"Nuevo mensaje","Nova tarefa":"Nueva tarea","Novo evento":"Nuevo evento","Novo contato":"Nuevo contacto","Nova regra":"Nueva regla",
  "Pesquisar e-mails, pessoas, eventos...":"Buscar correos, personas, eventos...","Pesquisar":"Buscar","Sincronizar":"Sincronizar","Todas":"Todas","Não lidas":"No leídas","Sinalizadas":"Marcadas","Fixadas":"Fijadas","Anexos":"Adjuntos",
  "Responder":"Responder","Responder a todos":"Responder a todos","Encaminhar":"Reenviar","Redirecionar":"Redirigir","Reenviar":"Enviar de nuevo","Arquivar":"Archivar","Excluir":"Eliminar","Imprimir":"Imprimir",
  "Criar tarefa":"Crear tarea","Criar evento":"Crear evento","Salvar EML":"Guardar EML","Importar":"Importar","Exportar":"Exportar","Salvar":"Guardar","Cancelar":"Cancelar","Fechar":"Cerrar",
  "Hoje":"Hoy","Ontem":"Ayer","Esta semana":"Esta semana","Mais antigas":"Más antiguos","Mais recentes":"Más recientes","Remetente":"Remitente","Assunto":"Asunto","Status":"Estado",
  "Selecione uma mensagem":"Selecciona un mensaje","Leia, responda e organize sem sair da mesma tela.":"Lee, responde y organiza sin salir de la misma pantalla.",
  "MENSAGEM":"MENSAJE","FAVORITOS":"FAVORITOS","PASTAS":"CARPETAS","CATEGORIAS":"CATEGORÍAS","PESQUISAS SALVAS":"BÚSQUEDAS GUARDADAS","AUTOMAÇÕES":"AUTOMATIZACIONES",
  "Prioridade baixa":"Prioridad baja","Prioridade normal":"Prioridad normal","Prioridade alta":"Prioridad alta","Importante":"Importante","Silenciar":"Silenciar","Liberar conversa":"Reactivar conversación","Ignorar conversa":"Ignorar conversación",
  "Mover para...":"Mover a...","Copiar para...":"Copiar a...","Organizar":"Organizar","Cabeçalhos":"Encabezados","Fonte":"Fuente","Nova janela":"Nueva ventana","Bloquear remetente":"Bloquear remitente","Confiar remetente":"Confiar en remitente",
  "Dia":"Día","3 dias":"3 días","Semana":"Semana","Semana útil":"Semana laboral","Mês":"Mes","Agenda":"Agenda","Lado a lado":"Lado a lado","Feriados":"Festivos",
  "Título":"Título","Início":"Inicio","Fim":"Fin","Local":"Lugar","Descrição":"Descripción","Participantes obrigatórios":"Participantes obligatorios","Participantes opcionais":"Participantes opcionales","Salas e recursos":"Salas y recursos",
  "Recorrência":"Repetición","Não repetir":"No repetir","Diária":"Diaria","Semanal":"Semanal","Mensal":"Mensual","Anual":"Anual","Repetir até":"Repetir hasta","Fuso horário":"Zona horaria",
  "Mostrar como":"Mostrar como","Ocupado":"Ocupado","Provisório":"Provisional","Livre":"Libre","Lembrete":"Recordatorio","Aceitar":"Aceptar","Recusar":"Rechazar","Sem resposta":"Sin respuesta","Aceito":"Aceptado","Recusado":"Rechazado",
  "Respostas dos participantes":"Respuestas de participantes","Manter convite na caixa de entrada após responder":"Mantener invitación en la bandeja tras responder","Enviar/atualizar convite":"Enviar/actualizar invitación","Cancelar reunião":"Cancelar reunión",
  "Contatos":"Contactos","Novo grupo":"Nuevo grupo","Todos os grupos":"Todos los grupos","Mesclar duplicados":"Combinar duplicados","Favorito":"Favorito","Nome":"Nombre","Sobrenome":"Apellido","Nome de exibição":"Nombre para mostrar","Apelido":"Apodo","Empresa":"Empresa","Cargo":"Cargo",
  "E-mails":"Correos","Telefones":"Teléfonos","Endereços":"Direcciones","Datas importantes":"Fechas importantes","Grupos / listas":"Grupos / listas","Observações":"Observaciones","Origem":"Origen","compartilhado":"compartido","compartilhada":"compartida",
  "ABERTAS":"ABIERTAS","CONCLUÍDAS":"COMPLETADAS","Atrasadas":"Atrasadas","Próximas":"Próximas","Meu dia":"Mi día","Lista":"Lista","Prioridade":"Prioridad","Baixa":"Baja","Normal":"Normal","Alta":"Alta","Vencimento":"Vencimiento",
  "Adicionar tarefa para hoje":"Añadir tarea para hoy","Nenhuma tarefa nesta visualização.":"No hay tareas en esta vista.","Reabrir":"Reabrir","Concluir":"Completar",
  "Nova nota":"Nueva nota","Fixar":"Fijar","Desafixar":"Desfijar","Cor":"Color","Executar regras agora":"Ejecutar reglas ahora","Executando...":"Ejecutando...","Regra ativa":"Regla activa","Parar após esta regra":"Detener después de esta regla",
  "Campo":"Campo","Operador":"Operador","Valor":"Valor","Ação":"Acción","Contém":"Contiene","É exatamente":"Es exactamente","Maior que":"Mayor que","Menor que":"Menor que","Mover para pasta":"Mover a carpeta","Copiar para pasta":"Copiar a carpeta","Adicionar categoria":"Añadir categoría","Encaminhar para":"Reenviar a",
  "Sobre o Seven Mail":"Acerca de Seven Mail","Cliente desktop local-first":"Cliente de escritorio local-first","Idioma, data e hora":"Idioma, fecha y hora","Idioma":"Idioma","Formato de data":"Formato de fecha","Formato de hora":"Formato de hora","Primeiro dia":"Primer día","Fuso principal":"Zona principal","Fusos secundários":"Zonas secundarias",
  "Horário de trabalho":"Horario laboral","Local de trabalho":"Lugar de trabajo","Aparência":"Apariencia","Sistema":"Sistema","Claro":"Claro","Escuro":"Oscuro","Lista compacta":"Lista compacta","Linhas de prévia":"Líneas de vista previa","Painel de leitura":"Panel de lectura","À direita":"A la derecha","Abaixo":"Abajo","Desativado":"Desactivado",
  "Envio":"Envío","Desfazer envio":"Deshacer envío","Confirmar antes de enviar":"Confirmar antes de enviar","Escrita e idioma":"Escritura e idioma","Idioma de composição":"Idioma de redacción","Autocorreção conservadora":"Autocorrección conservadora","Capitalização automática":"Mayúsculas automáticas","Dicionário personalizado":"Diccionario personalizado",
  "Sincronização e notificações":"Sincronización y notificaciones","Intervalo":"Intervalo","Retenção local":"Retención local","Sincronizações simultâneas":"Sincronizaciones simultáneas","Economia de bateria":"Ahorro de batería","Economia de memória":"Ahorro de memoria","Horário silencioso":"Horario silencioso",
  "Recusar automaticamente convites que conflitam com a agenda":"Rechazar automáticamente invitaciones que entren en conflicto con el calendario",
  "Ausência e encaminhamento":"Ausencia y reenvío","Resposta automática":"Respuesta automática","Encaminhamento automático":"Reenvío automático","Dados locais":"Datos locales","Dados":"Datos","Cache":"Caché","Fila":"Cola",
  "Contas":"Cuentas","Adicionar conta":"Añadir cuenta","Conta padrão":"Cuenta predeterminada","Testar conexão":"Probar conexión","Remover conta":"Eliminar cuenta","Senha":"Contraseña","Servidor":"Servidor","Porta":"Puerto",
  "Assinaturas":"Firmas","Nova assinatura":"Nueva firma","Usar como padrão nesta conta":"Usar como predeterminada en esta cuenta","Conteúdo":"Contenido","Perfis":"Perfiles","Extensões":"Extensiones","Ativar":"Activar","Desativar":"Desactivar","Permissões":"Permisos",
  "Nova pasta":"Nueva carpeta","Renomear":"Renombrar","Compartilhar":"Compartir","Compartilhado":"Compartido","Somente leitura":"Solo lectura","Editar":"Editar","Delegar":"Delegar",
  "Carregando sua caixa e espaço de trabalho":"Cargando tu correo y espacio de trabajo","Preparando seu espaço":"Preparando tu espacio","Tudo pronto":"Todo listo","Carregando...":"Cargando...","Nenhum resultado":"Sin resultados",
  "Sim":"Sí","Não":"No","De":"De","Para":"Para","Cc":"Cc","Cco":"Cco","Corpo":"Cuerpo","Anexo":"Adjunto","Anexar":"Adjuntar","Enviar":"Enviar","Programar envio":"Programar envío",
};

const DICTIONARIES: Record<Exclude<AppLocale,"pt-BR">,Dictionary> = {"en-US":EN,"es-ES":ES};
const textOriginal=new WeakMap<Text,string>();
const attrOriginal=new WeakMap<Element,Map<string,string>>();
let locale:AppLocale="pt-BR";
let observer:MutationObserver|undefined;

function translateDynamic(value:string,dict:Dictionary):string {
  if(dict[value]) return dict[value];
  const rules:Array<[RegExp,(match:RegExpMatchArray)=>string]>=[
    [/^(\d+) mensagens?$/,m=>locale==="en-US"?`${m[1]} messages`:`${m[1]} mensajes`],
    [/^(\d+) eventos?$/,m=>locale==="en-US"?`${m[1]} events`:`${m[1]} eventos`],
    [/^(\d+) tarefas?$/,m=>locale==="en-US"?`${m[1]} tasks`:`${m[1]} tareas`],
    [/^A cada (\d+) minutos?$/,m=>locale==="en-US"?`Every ${m[1]} minutes`:`Cada ${m[1]} minutos`],
    [/^(\d+) dias?$/,m=>locale==="en-US"?`${m[1]} days`:`${m[1]} días`],
    [/^Vence (.+)$/,m=>locale==="en-US"?`Due ${m[1]}`:`Vence ${m[1]}`],
    [/^Atrasada · (.+)$/,m=>locale==="en-US"?`Overdue · ${m[1]}`:`Atrasada · ${m[1]}`],
  ];
  for(const [pattern,render] of rules){
    const match=value.match(pattern);
    if(match) return render(match);
  }
  return value;
}

function translated(value:string):string {
  if(locale==="pt-BR") return value;
  return translateDynamic(value,DICTIONARIES[locale]);
}

function translateTextNode(node:Text){
  const current=node.data;
  const trimmed=current.trim();
  if(!trimmed) return;
  if(!textOriginal.has(node)) textOriginal.set(node,trimmed);
  const original=textOriginal.get(node)!;
  const next=translated(original);
  if(next===trimmed) return;
  const leading=current.match(/^\s*/)?.[0]??"";
  const trailing=current.match(/\s*$/)?.[0]??"";
  node.data=leading+next+trailing;
}

const ATTRS=["placeholder","title","aria-label"] as const;
function translateElement(element:Element){
  let originals=attrOriginal.get(element);
  if(!originals){originals=new Map();attrOriginal.set(element,originals);}
  for(const attr of ATTRS){
    const current=element.getAttribute(attr);
    if(!current) continue;
    if(!originals.has(attr)) originals.set(attr,current);
    const original=originals.get(attr)!;
    const next=translated(original);
    if(next!==current) element.setAttribute(attr,next);
  }
}

function translateTree(root:Node){
  if(root.nodeType===Node.TEXT_NODE) translateTextNode(root as Text);
  if(root.nodeType===Node.ELEMENT_NODE) translateElement(root as Element);
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
  let node=walker.nextNode();
  while(node){
    if(node.nodeType===Node.TEXT_NODE) translateTextNode(node as Text);
    else translateElement(node as Element);
    node=walker.nextNode();
  }
}

export function setApplicationLocale(next:AppLocale){
  locale=next;
  document.documentElement.lang=next;
  translateTree(document.body);
  observer?.disconnect();
  observer=new MutationObserver((records)=>{
    for(const record of records){
      if(record.type==="characterData"&&record.target.nodeType===Node.TEXT_NODE){
        translateTextNode(record.target as Text);
      }
      for(const node of record.addedNodes) translateTree(node);
      if(record.type==="attributes"&&record.target.nodeType===Node.ELEMENT_NODE){
        translateElement(record.target as Element);
      }
    }
  });
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:[...ATTRS]});
}
