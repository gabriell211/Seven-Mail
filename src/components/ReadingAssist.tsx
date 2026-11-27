import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import type { MailMessage } from "../types";

export function ReadingAssist({message,immersiveOpen=false,onImmersiveClose,onClose}:{
  message:MailMessage;
  immersiveOpen?:boolean;
  onImmersiveClose?:()=>void;
  onClose?:()=>void;
}){
  const [speaking,setSpeaking]=useState(false);
  const [error,setError]=useState("");
  const current=useRef<SpeechSynthesisUtterance|null>(null);
  const supported=typeof window!=="undefined"&&"speechSynthesis" in window&&typeof SpeechSynthesisUtterance!=="undefined";
  const text=useMemo(()=>{
    const raw=message.bodyText?.trim()||message.preview||"";
    return [message.subject,`De ${message.from.name||message.from.email}`,raw].filter(Boolean).join(".\n\n");
  },[message]);
  useEffect(()=>()=>{if(current.current){current.current=null;window.speechSynthesis.cancel();}},[]);
  function toggleSpeech(){
    if(!supported)return;
    const speech=window.speechSynthesis;
    setError("");
    if(current.current){
      current.current=null;
      speech.cancel();
      setSpeaking(false);
      return;
    }
    try{
      const utterance=new SpeechSynthesisUtterance(text);
      utterance.lang=document.documentElement.lang||"pt-BR";
      utterance.rate=1;
      utterance.pitch=1;
      const finish=(failed=false)=>{
        if(current.current!==utterance)return;
        current.current=null;
        setSpeaking(false);
        if(failed)setError("Não foi possível ler a mensagem em voz alta.");
      };
      utterance.onend=()=>finish();
      utterance.onerror=()=>finish(true);
      speech.cancel();
      current.current=utterance;
      setSpeaking(true);
      speech.speak(utterance);
    }catch{
      current.current=null;
      setSpeaking(false);
      setError("Não foi possível iniciar a leitura em voz alta.");
    }
  }
  const label=speaking?"Parar leitura":"Ler em voz alta";
  const speechButton=()=> <button type="button" className={`read-aloud-button icon-button${speaking?" active":""}`} aria-label={label} aria-pressed={speaking} disabled={!supported||!text.trim()} title={!supported?"Leitura em voz alta indisponível neste sistema":error||label} onClick={toggleSpeech}><Icon name="speaking" size={20}/></button>;
  return <>
    {speechButton()}
    {error&&<span className="read-aloud-announcement" role="alert">{error}</span>}
    {immersiveOpen&&createPortal(<div className="immersive-reader-backdrop" onMouseDown={onImmersiveClose}>
      <section className="immersive-reader" role="dialog" aria-modal="true" aria-label="Leitura imersiva" onMouseDown={event=>event.stopPropagation()}>
        <header>
          <div><span className="eyebrow">LEITURA IMERSIVA</span><h1>{message.subject||"(sem assunto)"}</h1><p>{message.from.name||message.from.email} · {message.from.email}</p></div>
          <div className="icon-group">{speechButton()}<button type="button" className="icon-button" title="Fechar" aria-label="Fechar leitura imersiva" onClick={onImmersiveClose}><Icon name="x"/></button></div>
        </header>
        <article>{message.bodyText||message.preview}</article>
        {onClose&&<footer><button className="secondary" onClick={onClose}>Fechar mensagem</button></footer>}
      </section>
    </div>,document.body)}
  </>;
}
