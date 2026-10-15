import { LENS_COLORS } from "@paper-xray/contracts";

export function AnnotationColorPicker({ value, onChange, disabled }: { value: string; onChange: (color: string) => void; disabled?: boolean }) {
  return <div className="pxr-annotation-colors" role="group" aria-label="Annotation color">
    {LENS_COLORS.map(color => <button key={color.value} type="button" title={color.name} aria-label={color.name}
      aria-pressed={value === color.value} disabled={disabled} style={{ background: color.value }}
      onClick={() => onChange(color.value)}>{value === color.value ? "✓" : ""}</button>)}
  </div>;
}
