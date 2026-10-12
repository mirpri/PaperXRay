import { useId } from "react";
import type { ModelProvider } from "@paper-xray/contracts";

/** Shared by Lens configuration and AI replies; available models are suggestions. */
export function ProviderModelFields({ providers, userId, providerId, model, onChange, disabled = false, includePersonal = true, idPrefix, autoFocus = false }: {
  providers: ModelProvider[]; userId?: string | null; providerId: string; model: string;
  onChange: (providerId: string, model: string) => void; disabled?: boolean; includePersonal?: boolean; idPrefix?: string; autoFocus?: boolean;
}) {
  const generatedId = useId();
  const id = idPrefix ?? generatedId;
  const provider = providers.find(item => item.id === providerId);
  return <>
    <div><label className="pxr-label" htmlFor={`${id}-provider`}>PROVIDER</label>
      <select id={`${id}-provider`} className="pxr-input" value={providerId} disabled={disabled} autoFocus={autoFocus}
        onChange={event => {
          const next = providers.find(item => item.id === event.target.value);
          onChange(next?.id ?? "", next?.models[0] ?? "");
        }}>
        <option value="">Select a provider</option>
        <optgroup label="Organization providers">{providers.filter(item => item.ownerId === null).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
        {includePersonal && <optgroup label="My providers">{providers.filter(item => item.ownerId === userId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>}
      </select>
    </div>
    <div><label className="pxr-label" htmlFor={`${id}-model`}>MODEL</label>
      <input id={`${id}-model`} className="pxr-input" list={`${id}-models`} disabled={disabled || !provider}
        required={Boolean(providerId)} maxLength={255} placeholder="Select or enter a model" value={model}
        onChange={event => onChange(providerId, event.target.value)} />
      <datalist id={`${id}-models`}>{(provider?.models ?? []).map(value => <option key={value} value={value} />)}</datalist>
    </div>
  </>;
}
