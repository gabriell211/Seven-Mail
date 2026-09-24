import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import type { MailMessage } from "../types";

export function ReadingAssist({
  message,
  onClose,
}: {
  message: MailMessage;
  onClose?: () => void;
}) {
  const [immersive,setImmersive]=useState(false);
  const [speaking,setSpeaking]=useState(false);

  const text=useMemo(()=>{
    const raw=message.bodyText?.trim()||message.preview||"";
    return [message.subject, `De ${message.from.name||message.from.email}`, raw].filter(Boolean).join(".\n\n");
  },[message]);

  useEffect(()=>{
    return ()=>{
      window.speechSynthesis.cancel();
    };
  },[]);

  function toggleSpeech(){
    const speech=window.speechSynthesis;
    if(speaking){
      speech.cancel();
      setSpeaking(false);
      return;
    }
    const utterance=new SpeechSynthesisUtterance(text);
    utterance.lang=document.documentElement.lang||"pt-BR";
    utterance.rate=1;
    utterance.pitch=1;
    utterance.onend=()=>setSpeaking(false);
    utterance.onerror=()=>setSpeaking(false);
    speech.cancel();
    speech.speak(utterance);
    setSpeaking(true);
  }

  return <>
    <div className="reading-assist-actions">
      <button className={speaking?"secondary active":"secondary"} onClick={toggleSpeech}>
        <Icon name="volume" size={14}/>{speaking?"Parar leitura":"Ler em voz alta"}
      </button>
      <button className="secondary" onClick={()=>setImmersive(true)}>
        <Icon name="expand" size={14}/> Leitura imersiva
      </button>
    </div>

    {immersive&&<div className="immersive-reader-backdrop" onMouseDown={()=>setImmersive(false)}>
      <section className="immersive-reader" onMouseDown={(event)=>event.stopPropagation()}>
        <header>
          <div><span className="eyebrow">LEITURA IMERSIVA</span><h1>{message.subject||"(sem assunto)"}</h1><p>{message.from.name||message.from.email} · {message.from.email}</p></div>
          <div className="icon-group">
            <button className={speaking?"icon-button active":"icon-button"} title="Ler em voz alta" onClick={toggleSpeech}><Icon name="volume"/></button>
            <button className="icon-button" title="Fechar" onClick={()=>setImmersive(false)}><Icon name="x"/></button>
          </div>
        </header>
        <article>{message.bodyText||message.preview}</article>
        {onClose&&<footer><button className="secondary" onClick={onClose}>Fechar mensagem</button></footer>}
      </section>
    </div>}
  </>;
}
