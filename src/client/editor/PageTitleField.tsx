import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from '../i18n';

/** A pasted or keyed line break would put a newline in the stored title, so
 * the field keeps the title a single logical line, like the old input did. */
export function singleLineTitle(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

/** Auto-growing title field for the page editor. A single-line <input> clips
 * long titles at the right edge; a one-row <textarea> wraps and resizes to
 * its content instead. Same class name, aria-label, placeholder and 160
 * character limit as before. */
export function PageTitleField({
  value,
  onChange,
}: {
  value: string;
  onChange: (title: string) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fitToContent = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    fitToContent();
    // Text wraps differently when the field's width changes (viewport or
    // panel resize), so the fitted height must be recalculated then too,
    // not only when the value changes.
    const observer = new ResizeObserver(fitToContent);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="document-title"
      aria-label={t('doc.pageTitle')}
      placeholder={t('doc.untitledPage')}
      maxLength={160}
      rows={1}
      value={value}
      onChange={(event) => onChange(singleLineTitle(event.target.value))}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.preventDefault();
      }}
    />
  );
}
