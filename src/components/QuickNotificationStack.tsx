import { Icon } from "../icons";
import type { MailMessage } from "../types";

export function QuickNotificationStack({
  messages,
  onDismiss,
  onOpen,
  onRead,
  onArchive,
}: {
  messages: MailMessage[];
  onDismiss: (messageId: string) => void;
  onOpen: (message: MailMessage) => void;
  onRead: (message: MailMessage) => void;
  onArchive: (message: MailMessage) => void;
}) {
  if(messages.length===0) return null;

  return <aside className="quick-notification-stack" aria-label="Novas mensagens">
    {messages.slice(0,3).map((message)=><article className="quick-notification" key={message.id}>
      <button className="quick-notification-close" aria-label="Fechar" onClick={()=>onDismiss(message.id)}><Icon name="x" size={12}/></button>
      <div className="quick-notification-copy">
        <span>{message.from.name?.trim()||message.from.email}</span>
        <b>{message.subject.trim()||"(sem assunto)"}</b>
        <small>{message.preview}</small>
      </div>
      <div className="quick-notification-actions">
        <button onClick={()=>onOpen(message)}>Abrir</button>
        {!message.isRead&&<button onClick={()=>onRead(message)}>Lida</button>}
        <button onClick={()=>onArchive(message)}>Arquivar</button>
      </div>
    </article>)}
  </aside>;
}
