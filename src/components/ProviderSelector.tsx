import { Icon } from "../icons";
import type { AccountProfile } from "../types";

type Provider = AccountProfile["provider"];

const PROVIDERS = [
  { id: "gmail", label: "Gmail", logo: "/providers/gmail.svg" },
  { id: "microsoft", label: "Microsoft", logo: "/providers/microsoft.svg" },
  { id: "yahoo", label: "Yahoo", logo: "/providers/yahoo.svg" },
  { id: "icloud", label: "iCloud", logo: "/providers/icloud.svg" },
  { id: "imap", label: "Outro", logo: null },
] as const satisfies ReadonlyArray<{ id: Provider; label: string; logo: string | null }>;

export function ProviderSelector({ value, onChange }: {
  value: Provider;
  onChange: (provider: Provider) => void;
}) {
  return (
    <div className="provider-grid provider-brand-grid" role="group" aria-label="Provedor de e-mail">
      {PROVIDERS.map(({ id, label, logo }) => (
        <button
          key={id}
          type="button"
          className={value === id ? "provider active" : "provider"}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          <span className={logo ? `provider-brand-mark provider-brand-mark--${id}` : "provider-brand-custom"} aria-hidden="true">
            {logo ? <img src={logo} alt="" draggable={false}/> : <Icon name="mail" size={23}/>}
          </span>
          <b>{label}</b>
        </button>
      ))}
    </div>
  );
}
