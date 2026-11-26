export type ConnectionGuidance = {
  title: string;
  description: string;
  steps: readonly string[];
  links: readonly { label: string; url: string }[];
};

export function connectionGuidance(error: string, email: string, provider: string): ConnectionGuidance | null {
  const domain = email.trim().split("@").pop()?.toLowerCase();
  const gmail = provider === "gmail" || domain === "gmail.com" || domain === "googlemail.com";
  if (gmail && /application[-\s]specific password required|invalidsecondfactor|app(?:lication)?[-\s]password required|534[\s:-]+5\.7\.9/i.test(error)) {
    return {
      title: "O Gmail exige uma senha de aplicativo",
      description: "O Google recusou a autenticação por senha comum. Para conectar por IMAP e SMTP, use uma senha de aplicativo gerada na sua Conta Google.",
      steps: [
        "Ative a verificação em duas etapas na Conta Google.",
        "Abra Senhas de aplicativos e crie uma senha com o nome Seven Mail.",
        "Copie os 16 caracteres, cole no campo de senha e tente conectar novamente.",
      ],
      links: [
        { label: "Ativar verificação em duas etapas", url: "https://myaccount.google.com/security" },
        { label: "Gerar senha de aplicativo", url: "https://myaccount.google.com/apppasswords" },
      ],
    };
  }
  return null;
}
